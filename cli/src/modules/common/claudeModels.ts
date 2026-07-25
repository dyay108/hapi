import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { asString, isObject } from '@hapi/protocol'
import type { ClaudeModelSummary, ClaudeModelsResponse } from '@hapi/protocol/apiTypes'
import { getDefaultClaudeCodePath } from '@/claude/sdk/utils'
import { withBunRuntimeEnv } from '@/utils/bunRuntime'
import { getErrorMessage } from './rpcResponses'

export type ListClaudeModelsResponse = ClaudeModelsResponse

interface CacheEntry {
    expiresAt: number
    response: ListClaudeModelsResponse
}

const CACHE_TTL_MS = 60_000
const PROBE_TIMEOUT_MS = 30_000
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<ListClaudeModelsResponse>>()

function optionalBoolean(entry: Record<string, unknown>, key: string): boolean | undefined {
    return typeof entry[key] === 'boolean' ? entry[key] : undefined
}

/**
 * Pull the model catalog out of a Claude Code `initialize` control response.
 * Returns null when the response has no `models` array at all, which is how we
 * tell "this CLI build is too old to report models" apart from "this account
 * has no models" — the former falls back to the static presets in the web UI.
 */
export function parseClaudeModelCatalog(initialization: unknown): ClaudeModelSummary[] | null {
    if (!isObject(initialization) || !Array.isArray(initialization.models)) {
        return null
    }

    const models: ClaudeModelSummary[] = []
    const seen = new Set<string>()

    for (const entry of initialization.models) {
        if (!isObject(entry)) continue

        const value = asString(entry.value)?.trim()
        if (!value || seen.has(value)) continue
        seen.add(value)

        const displayName = asString(entry.displayName)?.trim() || value
        const description = asString(entry.description)?.trim() || undefined
        const resolvedModel = asString(entry.resolvedModel)?.trim() || undefined
        const supportedEffortLevels = Array.isArray(entry.supportedEffortLevels)
            ? Array.from(new Set(
                entry.supportedEffortLevels
                    .filter((level): level is string => typeof level === 'string')
                    .map((level) => level.trim())
                    .filter(Boolean)
            ))
            : undefined
        const supportsEffort = optionalBoolean(entry, 'supportsEffort')
        const supportsAdaptiveThinking = optionalBoolean(entry, 'supportsAdaptiveThinking')
        const supportsFastMode = optionalBoolean(entry, 'supportsFastMode')
        const supportsAutoMode = optionalBoolean(entry, 'supportsAutoMode')

        models.push({
            value,
            displayName,
            ...(description ? { description } : {}),
            ...(resolvedModel ? { resolvedModel } : {}),
            ...(supportsEffort !== undefined ? { supportsEffort } : {}),
            ...(supportedEffortLevels && supportedEffortLevels.length > 0
                ? { supportedEffortLevels }
                : {}),
            ...(supportsAdaptiveThinking !== undefined ? { supportsAdaptiveThinking } : {}),
            ...(supportsFastMode !== undefined ? { supportsFastMode } : {}),
            ...(supportsAutoMode !== undefined ? { supportsAutoMode } : {})
        })
    }

    return models
}

function stopProbe(child: ChildProcessWithoutNullStreams, lines: Interface): void {
    lines.close()
    child.stdin.end()
    if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM')
    }
}

async function runClaudeModelsProbe(cwd: string): Promise<ListClaudeModelsResponse> {
    const executable = getDefaultClaudeCodePath()
    const env = withBunRuntimeEnv({
        ...process.env,
        CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT ?? 'sdk-ts'
    }, { allowBunBeBun: false })
    const child = spawn(executable, [
        '--output-format', 'stream-json',
        '--verbose',
        '--input-format', 'stream-json'
    ], {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: process.platform === 'win32'
    }) as ChildProcessWithoutNullStreams
    const lines = createInterface({ input: child.stdout })

    try {
        return await new Promise<ListClaudeModelsResponse>((resolve, reject) => {
            const requestId = randomUUID()
            let stderr = ''
            let settled = false

            const finish = (callback: () => void): void => {
                if (settled) return
                settled = true
                clearTimeout(timeout)
                callback()
            }
            const timeout = setTimeout(() => {
                finish(() => reject(new Error('Claude model discovery timed out')))
            }, PROBE_TIMEOUT_MS)

            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString()
            })
            child.once('error', (error) => {
                finish(() => reject(error))
            })
            child.once('exit', (code) => {
                finish(() => reject(new Error(
                    stderr.trim() || `Claude model discovery exited with code ${code ?? 'unknown'}`
                )))
            })
            child.stdin.once('error', (error) => {
                finish(() => reject(error))
            })
            lines.on('line', (line) => {
                if (!line.trim()) return

                let message: unknown
                try {
                    message = JSON.parse(line)
                } catch {
                    return
                }
                if (!isObject(message) || message.type !== 'control_response' || !isObject(message.response)) {
                    return
                }
                const response = message.response
                if (response.request_id !== requestId) return
                if (response.subtype !== 'success') {
                    finish(() => reject(new Error(asString(response.error) ?? 'Claude model discovery failed')))
                    return
                }

                const models = parseClaudeModelCatalog(response.response)
                if (!models) {
                    finish(() => reject(new Error('Claude Code initialize response did not include models')))
                    return
                }
                finish(() => resolve({ success: true, models }))
            })

            child.stdin.write(JSON.stringify({
                request_id: requestId,
                type: 'control_request',
                request: { subtype: 'initialize' }
            }) + '\n')
        })
    } finally {
        stopProbe(child, lines)
    }
}

const ANTHROPIC_VERSION = '2023-06-01'
const MODELS_API_TIMEOUT_MS = 10_000
const MODELS_API_PAGE_LIMIT = 100
/** Backstop against a pagination bug looping forever; 100/page covers the catalog many times over. */
const MODELS_API_MAX_PAGES = 10

/**
 * Credentials for the Models API, if the environment carries any.
 *
 * An API key goes on `x-api-key`; an OAuth token goes on `Authorization: Bearer`
 * and additionally needs the oauth beta header. Returns null when neither is
 * set — the common case for Claude Code subscription auth, where the token
 * lives in the CLI's own credential store rather than the environment.
 */
function getAnthropicAuthHeaders(): Record<string, string> | null {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
    if (apiKey) {
        return { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION }
    }

    const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim()
    if (authToken) {
        return {
            authorization: `Bearer ${authToken}`,
            'anthropic-version': ANTHROPIC_VERSION,
            'anthropic-beta': 'oauth-2025-04-20'
        }
    }

    return null
}

export function formatContextWindow(tokens: unknown): string | null {
    if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) {
        return null
    }
    if (tokens >= 1_000_000) {
        return `${Math.round(tokens / 100_000) / 10}M context`
    }
    if (tokens >= 1_000) {
        return `${Math.round(tokens / 1_000)}K context`
    }
    return `${tokens} context`
}

export function parseAnthropicModelsPage(body: unknown): {
    models: ClaudeModelSummary[]
    lastId: string | null
    hasMore: boolean
} {
    if (!isObject(body) || !Array.isArray(body.data)) {
        return { models: [], lastId: null, hasMore: false }
    }

    const models: ClaudeModelSummary[] = []
    for (const entry of body.data) {
        if (!isObject(entry)) continue
        const id = asString(entry.id)?.trim()
        if (!id) continue

        const displayName = asString(entry.display_name)?.trim() || id
        const context = formatContextWindow(entry.max_input_tokens)
        models.push({
            value: id,
            displayName,
            // The Models API has no prose description, so describe the model by
            // the one property that actually changes how it behaves for a user.
            ...(context ? { description: `${displayName} · ${context}` } : {}),
            resolvedModel: id
        })
    }

    return {
        models,
        lastId: asString(body.last_id) ?? null,
        hasMore: body.has_more === true
    }
}

/**
 * Every model the account can actually call, from `GET /v1/models`.
 *
 * The CLI's own catalog only advertises a handful of curated aliases (`sonnet`,
 * `opus`, …) — it omits pinned versioned ids such as `claude-opus-4-8`, which
 * Claude Code nonetheless accepts and runs. This closes that gap.
 *
 * Best effort by design: with no credential in the environment, or on any
 * network/HTTP failure, it yields an empty list and the caller falls back to the
 * CLI catalog alone. Never throws.
 */
export async function listAnthropicApiModels(): Promise<ClaudeModelSummary[]> {
    const headers = getAnthropicAuthHeaders()
    if (!headers) {
        return []
    }

    const baseUrl = (process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com')
        .replace(/\/+$/, '')
    const collected: ClaudeModelSummary[] = []
    let afterId: string | null = null

    try {
        for (let page = 0; page < MODELS_API_MAX_PAGES; page += 1) {
            const url = new URL(`${baseUrl}/v1/models`)
            url.searchParams.set('limit', String(MODELS_API_PAGE_LIMIT))
            if (afterId) {
                url.searchParams.set('after_id', afterId)
            }

            const response = await fetch(url, {
                headers,
                signal: AbortSignal.timeout(MODELS_API_TIMEOUT_MS)
            })
            if (!response.ok) {
                break
            }

            const parsed = parseAnthropicModelsPage(await response.json())
            collected.push(...parsed.models)
            if (!parsed.hasMore || !parsed.lastId) {
                break
            }
            afterId = parsed.lastId
        }
    } catch {
        // Offline, no network egress, bad credential — fall back to the catalog.
        return collected
    }

    return collected
}

/** Union by model value, preserving the order sources were supplied in. */
function mergeModelSummaries(...sources: ClaudeModelSummary[][]): ClaudeModelSummary[] {
    const merged: ClaudeModelSummary[] = []
    const seen = new Set<string>()

    for (const source of sources) {
        for (const model of source) {
            if (seen.has(model.value)) continue
            seen.add(model.value)
            merged.push(model)
        }
    }

    return merged
}

/**
 * Ask the machine which Claude models the current account can use.
 *
 * Two independent sources, unioned:
 *  1. the installed Claude Code CLI's `initialize` catalog — the curated aliases
 *     (`sonnet`, `opus`, …) the CLI's own `/model` picker offers, and
 *  2. `GET /v1/models` — every pinned versioned id the account can call
 *     (`claude-opus-4-8`, …), which the catalog omits.
 *
 * Neither is exhaustive alone and either can be unavailable, so a failure in one
 * does not fail the request. The web layer then unions the result with the
 * static presets, since neither source lists the `[1m]` aliases
 * (see `mergeClaudeModelOptions`).
 *
 * Results are briefly cached per working directory and concurrent callers share
 * a single probe.
 */
export async function listClaudeModels(cwd: string): Promise<ListClaudeModelsResponse> {
    const normalizedCwd = cwd.trim()
    if (!normalizedCwd) {
        return { success: false, error: 'cwd is required' }
    }

    const cached = cache.get(normalizedCwd)
    if (cached && cached.expiresAt > Date.now()) {
        return cached.response
    }

    const running = inflight.get(normalizedCwd)
    if (running) {
        return running
    }

    const promise = (async () => {
        try {
            const [catalog, apiModels] = await Promise.all([
                runClaudeModelsProbe(normalizedCwd).catch((error): ListClaudeModelsResponse => ({
                    success: false,
                    error: getErrorMessage(error, 'Failed to discover Claude models')
                })),
                listAnthropicApiModels()
            ])

            const models = mergeModelSummaries(catalog.models ?? [], apiModels)
            if (models.length === 0) {
                // Both sources came up empty — surface the CLI probe's reason.
                return {
                    success: false,
                    error: catalog.error ?? 'No Claude models discovered'
                } satisfies ListClaudeModelsResponse
            }

            const response = { success: true, models } satisfies ListClaudeModelsResponse
            cache.set(normalizedCwd, {
                expiresAt: Date.now() + CACHE_TTL_MS,
                response
            })
            return response
        } catch (error) {
            return {
                success: false,
                error: getErrorMessage(error, 'Failed to discover Claude models')
            } satisfies ListClaudeModelsResponse
        } finally {
            inflight.delete(normalizedCwd)
        }
    })()

    inflight.set(normalizedCwd, promise)
    return promise
}

export function _resetClaudeModelsCacheForTests(): void {
    cache.clear()
    inflight.clear()
}
