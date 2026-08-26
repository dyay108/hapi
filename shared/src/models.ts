/**
 * Aliases Claude Code has accepted for a long time.
 *
 * These are a *floor*, not the catalog: the live catalog is discovered from the
 * installed Claude Code CLI (see `listClaudeModels` in the CLI package) so new
 * Anthropic models become selectable without shipping an app update. Discovery
 * is per-account and does not enumerate every accepted alias — notably the
 * `[1m]` long-context variants — so these stay as a permanent fallback and are
 * merged with whatever discovery returns. See `mergeClaudeModelOptions`.
 */
export const CLAUDE_MODEL_LABELS = {
    sonnet: 'Sonnet',
    'sonnet[1m]': 'Sonnet 1M',
    opus: 'Opus',
    'opus[1m]': 'Opus 1M',
    fable: 'Fable',
    'fable[1m]': 'Fable 1M'
} as const

export type ClaudeModelPreset = keyof typeof CLAUDE_MODEL_LABELS
export const CLAUDE_MODEL_PRESETS = Object.keys(CLAUDE_MODEL_LABELS) as ClaudeModelPreset[]

export const GEMINI_MODEL_LABELS = {
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview',
    'gemini-3-flash-preview': 'Gemini 3 Flash Preview',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
} as const

export type GeminiModelPreset = keyof typeof GEMINI_MODEL_LABELS
export const GEMINI_MODEL_PRESETS = Object.keys(GEMINI_MODEL_LABELS) as GeminiModelPreset[]
export const DEFAULT_GEMINI_MODEL: GeminiModelPreset = 'gemini-2.5-pro'

// Order and labels mirror `agy models` output (the agy CLI's own listing) so the
// HAPI picker matches what users see in the terminal. IDs follow agy's
// `<model>-<effort>` convention (e.g. `gemini-3.5-flash-low` verified accepted by
// `agy --model`). NOTE: agy fetches the live list server-side and `agy models`
// needs an interactive keyring unlock, so this stays a hand-maintained mirror —
// update it when agy's listing changes.
export const AGY_MODEL_LABELS = {
    'gemini-3.7-flash-high': 'Gemini 3.7 Flash (High)',
    'gemini-3.7-flash-medium': 'Gemini 3.7 Flash (Medium)',
    'gemini-3.7-flash-low': 'Gemini 3.7 Flash (Low)',
    'gemini-3.6-flash-high': 'Gemini 3.6 Flash (High)',
    'gemini-3.6-flash-medium': 'Gemini 3.6 Flash (Medium)',
    'gemini-3.6-flash-low': 'Gemini 3.6 Flash (Low)',
    'gemini-3.5-flash-medium': 'Gemini 3.5 Flash (Medium)',
    'gemini-3.5-flash-high': 'Gemini 3.5 Flash (High)',
    'gemini-3.5-flash-low': 'Gemini 3.5 Flash (Low)',
    'gemini-3.1-pro-low': 'Gemini 3.1 Pro (Low)',
    'gemini-3.1-pro-high': 'Gemini 3.1 Pro (High)',
    'claude-sonnet-4-6': 'Claude Sonnet 4.6 (Thinking)',
    'claude-opus-4-6-thinking': 'Claude Opus 4.6 (Thinking)',
    'gpt-oss-120b-medium': 'GPT-OSS 120B (Medium)',
} as const

export type AgyModelPreset = keyof typeof AGY_MODEL_LABELS
export const AGY_MODEL_PRESETS = Object.keys(AGY_MODEL_LABELS) as AgyModelPreset[]

export function getAgyModelLabel(model: string): string | null {
    const trimmedModel = model.trim()
    if (!trimmedModel) return null
    return AGY_MODEL_LABELS[trimmedModel as AgyModelPreset] ?? null
}

export function isClaudeModelPreset(model: string | null | undefined): model is ClaudeModelPreset {
    return typeof model === 'string' && Object.hasOwn(CLAUDE_MODEL_LABELS, model)
}

export function getClaudeModelLabel(model: string): string | null {
    const trimmedModel = model.trim()
    if (!trimmedModel) {
        return null
    }

    return CLAUDE_MODEL_LABELS[trimmedModel as ClaudeModelPreset] ?? null
}

/**
 * One entry of the model catalog reported by the installed Claude Code CLI.
 * Structurally compatible with `ClaudeModelSummary` in apiTypes, declared here
 * so the shared model helpers stay free of protocol imports.
 */
export interface ClaudeCatalogModel {
    value: string
    displayName?: string
    description?: string
    resolvedModel?: string
}

export interface ClaudeModelOption {
    /** Value passed to Claude Code as `--model`. */
    value: string
    label: string
    description?: string
    /** Canonical model id this alias currently resolves to, when known. */
    resolvedModel?: string
    /** True when the option came from the live CLI catalog rather than the fallback presets. */
    discovered?: boolean
}

/** Values that mean "let Claude Code decide" rather than naming a model. */
export function isDefaultClaudeModelValue(value: string | null | undefined): boolean {
    const normalized = value?.trim().toLowerCase()
    return !normalized || normalized === 'auto' || normalized === 'default'
}

/**
 * Description of the catalog's "default" entry (e.g. "Sonnet 5 · Efficient for
 * routine tasks").
 *
 * `mergeClaudeModelOptions` drops that entry because each picker renders its
 * own Default option, but the blurb is still the only hint about what Default
 * actually resolves to — so callers can attach it to their own option.
 */
export function getClaudeDefaultModelDescription(
    catalog?: readonly ClaudeCatalogModel[] | null
): string | null {
    for (const entry of catalog ?? []) {
        if (isDefaultClaudeModelValue(entry.value)) {
            return entry.description?.trim() || null
        }
    }

    return null
}

/**
 * Build the selectable Claude model list as a union of every source we know
 * about, so the picker can only ever grow:
 *
 *  1. the live CLI catalog (authoritative for this account, picks up new models),
 *  2. the fallback presets above (the catalog omits the `[1m]` variants),
 *  3. the model the session is already running (never make the current model
 *     unselectable just because discovery does not list it).
 *
 * The "default" entry is deliberately excluded — callers render their own
 * Default/auto option, whose value is `null` in the composer and `'auto'` in
 * the new-session form.
 */
export function mergeClaudeModelOptions(
    catalog?: readonly ClaudeCatalogModel[] | null,
    currentModel?: string | null
): ClaudeModelOption[] {
    const options: ClaudeModelOption[] = []
    const seen = new Set<string>()

    const add = (option: ClaudeModelOption): void => {
        if (seen.has(option.value)) {
            return
        }
        seen.add(option.value)
        options.push(option)
    }

    for (const entry of catalog ?? []) {
        const value = entry.value?.trim()
        if (!value || isDefaultClaudeModelValue(value)) {
            continue
        }
        const description = entry.description?.trim()
        const resolvedModel = entry.resolvedModel?.trim()
        add({
            value,
            label: entry.displayName?.trim() || getClaudeModelLabel(value) || value,
            ...(description ? { description } : {}),
            ...(resolvedModel ? { resolvedModel } : {}),
            discovered: true
        })
    }

    for (const preset of CLAUDE_MODEL_PRESETS) {
        add({ value: preset, label: CLAUDE_MODEL_LABELS[preset] })
    }

    // A model neither source knows about is still in use right now, so it leads
    // the list rather than being buried under models the user did not pick.
    const trimmedCurrentModel = currentModel?.trim()
    if (
        trimmedCurrentModel
        && !isDefaultClaudeModelValue(trimmedCurrentModel)
        && !seen.has(trimmedCurrentModel)
    ) {
        options.unshift({
            value: trimmedCurrentModel,
            label: getClaudeModelLabel(trimmedCurrentModel) ?? trimmedCurrentModel
        })
    }

    return options
}
