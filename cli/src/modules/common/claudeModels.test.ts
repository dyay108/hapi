import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({
    spawnMock: vi.fn()
}))

vi.mock('node:child_process', async () => ({
    ...await vi.importActual<typeof import('node:child_process')>('node:child_process'),
    spawn: spawnMock
}))

vi.mock('@/claude/sdk/utils', () => ({
    getDefaultClaudeCodePath: () => 'claude'
}))

vi.mock('@/utils/bunRuntime', () => ({
    withBunRuntimeEnv: (env: NodeJS.ProcessEnv) => env
}))

import {
    _resetClaudeModelsCacheForTests,
    formatContextWindow,
    listAnthropicApiModels,
    listClaudeModels,
    parseAnthropicModelsPage,
    parseClaudeModelCatalog
} from './claudeModels'

const ORIGINAL_ENV = { ...process.env }

/** Models API responses are opt-in per test; default is "no credential". */
function stubModelsApi(pages: unknown[]): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => pages.shift() ?? { data: [], has_more: false }
    }))
    vi.stubGlobal('fetch', fetchMock)
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    return fetchMock
}

type FakeChild = EventEmitter & {
    stdin: PassThrough
    stdout: PassThrough
    stderr: PassThrough
    exitCode: number | null
    killed: boolean
    kill: (signal?: NodeJS.Signals) => boolean
}

function createChild(): FakeChild {
    const child = new EventEmitter() as FakeChild
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.exitCode = null
    child.killed = false
    child.kill = vi.fn(() => {
        child.killed = true
        child.exitCode = 0
        child.emit('exit', 0)
        return true
    })
    return child
}

/** Replies to the initialize control_request with the given payload. */
function createFakeChild(initialization: unknown): FakeChild {
    const child = createChild()
    child.stdin.on('data', (chunk) => {
        const request = JSON.parse(chunk.toString()) as { request_id: string }
        child.stdout.write(JSON.stringify({
            type: 'control_response',
            response: {
                subtype: 'success',
                request_id: request.request_id,
                response: initialization
            }
        }) + '\n')
    })
    return child
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    _resetClaudeModelsCacheForTests()
    // Default to "no Anthropic credential" so the CLI catalog is the only source.
    process.env = { ...ORIGINAL_ENV }
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_AUTH_TOKEN
})

afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
})

describe('formatContextWindow', () => {
    it('renders token counts at human scale', () => {
        expect(formatContextWindow(1_000_000)).toBe('1M context')
        expect(formatContextWindow(200_000)).toBe('200K context')
        expect(formatContextWindow(500)).toBe('500 context')
    })

    it('returns null for missing or nonsensical values', () => {
        expect(formatContextWindow(undefined)).toBeNull()
        expect(formatContextWindow(0)).toBeNull()
        expect(formatContextWindow(-1)).toBeNull()
        expect(formatContextWindow('200000')).toBeNull()
    })
})

describe('parseAnthropicModelsPage', () => {
    it('maps models and reports the pagination cursor', () => {
        expect(parseAnthropicModelsPage({
            data: [
                { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8', max_input_tokens: 1_000_000 },
                { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', max_input_tokens: 200_000 }
            ],
            has_more: true,
            last_id: 'claude-haiku-4-5'
        })).toEqual({
            models: [
                {
                    value: 'claude-opus-4-8',
                    displayName: 'Claude Opus 4.8',
                    description: 'Claude Opus 4.8 · 1M context',
                    resolvedModel: 'claude-opus-4-8'
                },
                {
                    value: 'claude-haiku-4-5',
                    displayName: 'Claude Haiku 4.5',
                    description: 'Claude Haiku 4.5 · 200K context',
                    resolvedModel: 'claude-haiku-4-5'
                }
            ],
            lastId: 'claude-haiku-4-5',
            hasMore: true
        })
    })

    it('tolerates a malformed body', () => {
        expect(parseAnthropicModelsPage({})).toEqual({ models: [], lastId: null, hasMore: false })
        expect(parseAnthropicModelsPage(null)).toEqual({ models: [], lastId: null, hasMore: false })
    })
})

describe('listAnthropicApiModels', () => {
    it('returns nothing and makes no request without a credential', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        expect(await listAnthropicApiModels()).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('sends the API key and follows pagination', async () => {
        const fetchMock = stubModelsApi([
            { data: [{ id: 'claude-opus-5', display_name: 'Claude Opus 5' }], has_more: true, last_id: 'claude-opus-5' },
            { data: [{ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' }], has_more: false }
        ])

        const models = await listAnthropicApiModels()

        expect(models.map((model) => model.value)).toEqual(['claude-opus-5', 'claude-opus-4-8'])
        expect(fetchMock).toHaveBeenCalledTimes(2)
        const [url, init] = fetchMock.mock.calls[1] as [URL, { headers: Record<string, string> }]
        expect(url.searchParams.get('after_id')).toBe('claude-opus-5')
        expect(init.headers['x-api-key']).toBe('sk-ant-test')
    })

    it('uses bearer auth plus the oauth beta header for a token', async () => {
        const fetchMock = stubModelsApi([{ data: [], has_more: false }])
        delete process.env.ANTHROPIC_API_KEY
        process.env.ANTHROPIC_AUTH_TOKEN = 'oat-test'

        await listAnthropicApiModels()

        const [, init] = fetchMock.mock.calls[0] as [URL, { headers: Record<string, string> }]
        expect(init.headers.authorization).toBe('Bearer oat-test')
        expect(init.headers['anthropic-beta']).toBe('oauth-2025-04-20')
        expect(init.headers['x-api-key']).toBeUndefined()
    })

    it('degrades to an empty list when the request fails', async () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('network unreachable')
        }))

        expect(await listAnthropicApiModels()).toEqual([])
    })

    it('degrades to an empty list on a non-2xx response', async () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))

        expect(await listAnthropicApiModels()).toEqual([])
    })
})

describe('parseClaudeModelCatalog', () => {
    it('normalizes model metadata and ignores malformed or duplicate rows', () => {
        expect(parseClaudeModelCatalog({
            models: [
                {
                    value: 'sonnet',
                    resolvedModel: 'claude-sonnet-5',
                    displayName: 'Sonnet',
                    description: 'Balanced',
                    supportsEffort: true,
                    supportedEffortLevels: ['low', 'high', 'high'],
                    supportsFastMode: false
                },
                { value: 'sonnet', displayName: 'Duplicate' },
                { displayName: 'Missing value' },
                { value: 'haiku', displayName: '' }
            ]
        })).toEqual([
            {
                value: 'sonnet',
                resolvedModel: 'claude-sonnet-5',
                displayName: 'Sonnet',
                description: 'Balanced',
                supportsEffort: true,
                supportedEffortLevels: ['low', 'high'],
                supportsFastMode: false
            },
            { value: 'haiku', displayName: 'haiku' }
        ])
    })

    it('keeps model ids it has never seen before verbatim', () => {
        // The whole point of discovery: an id shipped after this build still works.
        expect(parseClaudeModelCatalog({
            models: [{ value: 'claude-opus-6-20270101', displayName: 'Opus 6' }]
        })).toEqual([{ value: 'claude-opus-6-20270101', displayName: 'Opus 6' }])
    })

    it('distinguishes a missing catalog from an empty catalog', () => {
        expect(parseClaudeModelCatalog({})).toBeNull()
        expect(parseClaudeModelCatalog({ models: [] })).toEqual([])
    })
})

describe('listClaudeModels', () => {
    it('requests initialize from Claude Code and returns every advertised model', async () => {
        const child = createFakeChild({
            models: [
                { value: 'default', displayName: 'Default (recommended)' },
                { value: 'sonnet', displayName: 'Sonnet' },
                { value: 'opus', displayName: 'Opus' },
                { value: 'haiku', displayName: 'Haiku' }
            ]
        })
        spawnMock.mockReturnValueOnce(child)

        const result = await listClaudeModels('/workspace/project')

        expect(result).toEqual({
            success: true,
            models: [
                { value: 'default', displayName: 'Default (recommended)' },
                { value: 'sonnet', displayName: 'Sonnet' },
                { value: 'opus', displayName: 'Opus' },
                { value: 'haiku', displayName: 'Haiku' }
            ]
        })
        expect(spawnMock).toHaveBeenCalledWith('claude', [
            '--output-format', 'stream-json',
            '--verbose',
            '--input-format', 'stream-json'
        ], expect.objectContaining({ cwd: '/workspace/project', shell: false }))
        expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    })

    it('caches successful catalogs per working directory', async () => {
        spawnMock.mockReturnValueOnce(createFakeChild({
            models: [{ value: 'sonnet', displayName: 'Sonnet' }]
        }))

        await listClaudeModels('/workspace/project')
        await listClaudeModels('/workspace/project')

        expect(spawnMock).toHaveBeenCalledTimes(1)
    })

    it('shares one probe between concurrent callers', async () => {
        spawnMock.mockReturnValueOnce(createFakeChild({
            models: [{ value: 'sonnet', displayName: 'Sonnet' }]
        }))

        const [first, second] = await Promise.all([
            listClaudeModels('/workspace/project'),
            listClaudeModels('/workspace/project')
        ])

        expect(first).toEqual(second)
        expect(spawnMock).toHaveBeenCalledTimes(1)
    })

    it('reports a failure instead of throwing when the CLI exits early', async () => {
        const child = createChild()
        spawnMock.mockReturnValueOnce(child)
        queueMicrotask(() => {
            child.stderr.write('claude: command not found')
            child.emit('exit', 127)
        })

        const result = await listClaudeModels('/workspace/project')

        expect(result.success).toBe(false)
        expect(result.error).toContain('claude: command not found')
    })

    it('does not cache failures', async () => {
        const failing = createChild()
        spawnMock.mockReturnValueOnce(failing)
        queueMicrotask(() => failing.emit('exit', 1))
        await listClaudeModels('/workspace/project')

        spawnMock.mockReturnValueOnce(createFakeChild({
            models: [{ value: 'sonnet', displayName: 'Sonnet' }]
        }))
        const retry = await listClaudeModels('/workspace/project')

        expect(retry.success).toBe(true)
        expect(spawnMock).toHaveBeenCalledTimes(2)
    })

    it('unions the CLI catalog with pinned ids from the Models API', async () => {
        // The catalog offers curated aliases only; the Models API is what makes
        // a pinned id like claude-opus-4-8 selectable.
        spawnMock.mockReturnValueOnce(createFakeChild({
            models: [{ value: 'sonnet', displayName: 'Sonnet' }, { value: 'opus', displayName: 'Opus' }]
        }))
        stubModelsApi([{
            data: [
                { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8', max_input_tokens: 1_000_000 },
                { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', max_input_tokens: 200_000 }
            ],
            has_more: false
        }])

        const result = await listClaudeModels('/workspace/project')

        expect(result.success).toBe(true)
        expect(result.models?.map((model) => model.value))
            .toEqual(['sonnet', 'opus', 'claude-opus-4-8', 'claude-haiku-4-5'])
    })

    it('still returns the catalog when the Models API is unavailable', async () => {
        spawnMock.mockReturnValueOnce(createFakeChild({
            models: [{ value: 'sonnet', displayName: 'Sonnet' }]
        }))

        const result = await listClaudeModels('/workspace/project')

        expect(result.success).toBe(true)
        expect(result.models?.map((model) => model.value)).toEqual(['sonnet'])
    })

    it('still returns Models API results when the CLI probe fails', async () => {
        const child = createChild()
        spawnMock.mockReturnValueOnce(child)
        queueMicrotask(() => child.emit('exit', 127))
        stubModelsApi([{ data: [{ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' }], has_more: false }])

        const result = await listClaudeModels('/workspace/project')

        expect(result.success).toBe(true)
        expect(result.models?.map((model) => model.value)).toEqual(['claude-opus-4-8'])
    })

    it('does not duplicate a model reported by both sources', async () => {
        spawnMock.mockReturnValueOnce(createFakeChild({
            models: [{ value: 'claude-opus-4-8', displayName: 'Opus (alias)' }]
        }))
        stubModelsApi([{ data: [{ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' }], has_more: false }])

        const result = await listClaudeModels('/workspace/project')

        expect(result.models).toHaveLength(1)
        // Catalog wins on conflict — its labels are the account-curated ones.
        expect(result.models?.[0]?.displayName).toBe('Opus (alias)')
    })

    it('rejects an empty working directory without spawning', async () => {
        expect(await listClaudeModels('   ')).toEqual({ success: false, error: 'cwd is required' })
        expect(spawnMock).not.toHaveBeenCalled()
    })
})
