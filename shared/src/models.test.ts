import { describe, expect, test } from 'bun:test'
import {
    CLAUDE_MODEL_PRESETS,
    CLAUDE_MODEL_LABELS,
    DEFAULT_GEMINI_MODEL,
    GEMINI_MODEL_LABELS,
    GEMINI_MODEL_PRESETS,
    getClaudeDefaultModelDescription,
    getClaudeModelLabel,
    isClaudeModelPreset,
    isDefaultClaudeModelValue,
    mergeClaudeModelOptions,
} from './models'

describe('isClaudeModelPreset', () => {
    test('accepts valid presets', () => {
        for (const preset of CLAUDE_MODEL_PRESETS) {
            expect(isClaudeModelPreset(preset)).toBe(true)
        }
    })

    test('rejects unknown model string', () => {
        expect(isClaudeModelPreset('haiku')).toBe(false)
    })

    test('rejects null and undefined', () => {
        expect(isClaudeModelPreset(null)).toBe(false)
        expect(isClaudeModelPreset(undefined)).toBe(false)
    })
})

describe('getClaudeModelLabel', () => {
    test('returns label for known presets', () => {
        expect(getClaudeModelLabel('sonnet')).toBe('Sonnet')
        expect(getClaudeModelLabel('opus')).toBe('Opus')
        expect(getClaudeModelLabel('opus[1m]')).toBe('Opus 1M')
    })

    test('trims whitespace before lookup', () => {
        expect(getClaudeModelLabel('  sonnet  ')).toBe('Sonnet')
    })

    test('returns null for unknown model', () => {
        expect(getClaudeModelLabel('haiku')).toBeNull()
    })

    test('returns null for empty/whitespace-only string', () => {
        expect(getClaudeModelLabel('')).toBeNull()
        expect(getClaudeModelLabel('   ')).toBeNull()
    })
})

describe('isDefaultClaudeModelValue', () => {
    test('treats auto/default/empty as "let Claude Code decide"', () => {
        expect(isDefaultClaudeModelValue('auto')).toBe(true)
        expect(isDefaultClaudeModelValue('Default')).toBe(true)
        expect(isDefaultClaudeModelValue('  ')).toBe(true)
        expect(isDefaultClaudeModelValue(null)).toBe(true)
        expect(isDefaultClaudeModelValue('sonnet')).toBe(false)
    })
})

describe('getClaudeDefaultModelDescription', () => {
    test('returns the blurb for the catalog default entry', () => {
        expect(getClaudeDefaultModelDescription([
            { value: 'default', displayName: 'Default (recommended)', description: 'Sonnet 5 · Efficient' },
            { value: 'opus', displayName: 'Opus', description: 'Opus 5 · Capable' }
        ])).toBe('Sonnet 5 · Efficient')
    })

    test('returns null when there is no default entry or no catalog', () => {
        expect(getClaudeDefaultModelDescription([{ value: 'opus', displayName: 'Opus' }])).toBeNull()
        expect(getClaudeDefaultModelDescription([])).toBeNull()
        expect(getClaudeDefaultModelDescription()).toBeNull()
    })

    test('returns null when the default entry carries no description', () => {
        expect(getClaudeDefaultModelDescription([{ value: 'default', displayName: 'Default' }])).toBeNull()
    })
})

describe('mergeClaudeModelOptions', () => {
    // Shape returned by the Claude Code CLI initialize handshake. Note it omits
    // the `[1m]` aliases and exposes Fable only under its canonical id.
    const catalog = [
        { value: 'default', displayName: 'Default (recommended)', resolvedModel: 'claude-sonnet-5' },
        { value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 5', resolvedModel: 'claude-sonnet-5' },
        { value: 'claude-fable-5[1m]', displayName: 'Fable', resolvedModel: 'claude-fable-5' },
        { value: 'opus', displayName: 'Opus', resolvedModel: 'claude-opus-5' },
        { value: 'haiku', displayName: 'Haiku', resolvedModel: 'claude-haiku-4-5-20251001' },
    ]

    test('falls back to the presets when no catalog is available', () => {
        expect(mergeClaudeModelOptions().map((option) => option.value)).toEqual([...CLAUDE_MODEL_PRESETS])
        expect(mergeClaudeModelOptions(null).map((option) => option.value)).toEqual([...CLAUDE_MODEL_PRESETS])
        expect(mergeClaudeModelOptions([]).map((option) => option.value)).toEqual([...CLAUDE_MODEL_PRESETS])
    })

    test('surfaces newly discovered models the presets do not know about', () => {
        const values = mergeClaudeModelOptions(catalog).map((option) => option.value)
        expect(values).toContain('haiku')
        expect(values).toContain('claude-fable-5[1m]')
    })

    test('never drops a preset the catalog omits', () => {
        // The regression this guards: swapping presets for the catalog lost every
        // 1M variant, leaving users with fewer models than before.
        const values = mergeClaudeModelOptions(catalog).map((option) => option.value)
        for (const preset of CLAUDE_MODEL_PRESETS) {
            expect(values).toContain(preset)
        }
    })

    test('never returns fewer options than the presets alone', () => {
        expect(mergeClaudeModelOptions(catalog).length).toBeGreaterThanOrEqual(CLAUDE_MODEL_PRESETS.length)
    })

    test('lists catalog models first and marks them as discovered', () => {
        const options = mergeClaudeModelOptions(catalog)
        expect(options[0]).toEqual({
            value: 'sonnet',
            label: 'Sonnet',
            description: 'Sonnet 5',
            resolvedModel: 'claude-sonnet-5',
            discovered: true
        })
        expect(options.find((option) => option.value === 'sonnet[1m]')?.discovered).toBeUndefined()
    })

    test('drops the catalog default entry so callers own their Default option', () => {
        expect(mergeClaudeModelOptions(catalog).some((option) => option.value === 'default')).toBe(false)
    })

    test('prefers the catalog display name over the preset label', () => {
        const options = mergeClaudeModelOptions([
            { value: 'opus', displayName: 'Opus 5.1', resolvedModel: 'claude-opus-5-1' }
        ])
        expect(options.find((option) => option.value === 'opus')?.label).toBe('Opus 5.1')
    })

    test('keeps the running model selectable when discovery does not list it', () => {
        const options = mergeClaudeModelOptions(catalog, 'claude-opus-6-20270101')
        expect(options.find((option) => option.value === 'claude-opus-6-20270101')?.label)
            .toBe('claude-opus-6-20270101')
    })

    test('does not duplicate the running model or add auto as an entry', () => {
        expect(mergeClaudeModelOptions(catalog, 'sonnet').filter((option) => option.value === 'sonnet')).toHaveLength(1)
        expect(mergeClaudeModelOptions(catalog, 'auto').some((option) => option.value === 'auto')).toBe(false)
    })

    test('de-duplicates repeated catalog values', () => {
        const options = mergeClaudeModelOptions([
            { value: 'sonnet', displayName: 'Sonnet' },
            { value: ' sonnet ', displayName: 'Sonnet again' }
        ])
        expect(options.filter((option) => option.value === 'sonnet')).toHaveLength(1)
    })
})

describe('model constants consistency', () => {
    test('every CLAUDE_MODEL_PRESET has a label', () => {
        for (const preset of CLAUDE_MODEL_PRESETS) {
            expect(CLAUDE_MODEL_LABELS[preset]).toBeDefined()
        }
    })

    test('every GEMINI_MODEL_PRESET has a label', () => {
        for (const preset of GEMINI_MODEL_PRESETS) {
            expect(GEMINI_MODEL_LABELS[preset]).toBeDefined()
        }
    })

    test('DEFAULT_GEMINI_MODEL is a valid preset', () => {
        expect(GEMINI_MODEL_PRESETS).toContain(DEFAULT_GEMINI_MODEL)
    })
})
