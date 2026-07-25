import { mergeClaudeModelOptions, type ClaudeCatalogModel } from '@hapi/protocol'

export type ClaudeComposerModelOption = {
    value: string | null
    label: string
    description?: string
    /** Canonical model id covered by this Claude Code alias, when known. */
    resolvedModel?: string
}

function normalizeClaudeComposerModel(model?: string | null): string | null {
    const trimmedModel = model?.trim()
    if (!trimmedModel || trimmedModel === 'auto' || trimmedModel === 'default') {
        return null
    }

    return trimmedModel
}

/**
 * Composer model list: a `Default` entry followed by the union of the models
 * discovered on the machine and the static presets. Discovery is additive on
 * purpose — its catalog does not enumerate every alias Claude Code accepts, so
 * replacing the presets with it would remove working options (notably the `1M`
 * variants).
 */
export function getClaudeComposerModelOptions(
    currentModel?: string | null,
    catalog?: readonly ClaudeCatalogModel[] | null
): ClaudeComposerModelOption[] {
    const normalizedCurrentModel = normalizeClaudeComposerModel(currentModel)

    return [
        { value: null, label: 'Default' },
        ...mergeClaudeModelOptions(catalog, normalizedCurrentModel).map((option) => ({
            value: option.value,
            label: option.label,
            ...(option.description ? { description: option.description } : {}),
            ...(option.resolvedModel ? { resolvedModel: option.resolvedModel } : {})
        }))
    ]
}

export function getNextClaudeComposerModel(
    currentModel?: string | null,
    catalog?: readonly ClaudeCatalogModel[] | null
): string | null {
    const normalizedCurrentModel = normalizeClaudeComposerModel(currentModel)
    const options = getClaudeComposerModelOptions(normalizedCurrentModel, catalog)
    const currentIndex = options.findIndex((option) => option.value === normalizedCurrentModel)

    if (currentIndex === -1) {
        return options[0]?.value ?? null
    }

    return options[(currentIndex + 1) % options.length]?.value ?? null
}
