import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

import { ModelSelector } from './ModelSelector'

const CLAUDE_OPTIONS = [
    { value: 'auto', label: 'Default' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'opus', label: 'Opus' }
]

const baseProps = {
    agent: 'pi' as const,
    model: 'auto',
    isDisabled: false,
    onModelChange: vi.fn(),
}

describe('ModelSelector', () => {
    it('forwards a picked model', () => {
        const onModelChange = vi.fn()
        const { container } = render(
            <ModelSelector
                agent="claude"
                model="auto"
                options={CLAUDE_OPTIONS}
                isDisabled={false}
                onModelChange={onModelChange}
            />
        )
        const select = container.querySelector('select') as HTMLSelectElement

        fireEvent.change(select, { target: { value: 'opus' } })
        expect(onModelChange).toHaveBeenCalledWith('opus')
    })

    it('shows each option description in the dropdown, not just the selected one', () => {
        // The description has to be visible while choosing — a native <option>
        // renders plain text only, so it is folded into the label.
        const { container } = render(
            <ModelSelector
                agent="claude"
                model="auto"
                options={[
                    { value: 'auto', label: 'Default', description: 'Sonnet 5 · Efficient for routine tasks' },
                    { value: 'opus', label: 'Opus', description: 'Opus 5 · Best for everyday, complex tasks' },
                    { value: 'sonnet[1m]', label: 'Sonnet 1M' }
                ]}
                isDisabled={false}
                onModelChange={vi.fn()}
            />
        )
        const select = container.querySelector('select') as HTMLSelectElement

        expect(Array.from(select.options).map((option) => option.text)).toEqual([
            'Default — Sonnet 5 · Efficient for routine tasks',
            'Opus — Opus 5 · Best for everyday, complex tasks',
            'Sonnet 1M'
        ])
        // Values stay clean — only the visible text carries the description.
        expect(Array.from(select.options).map((option) => option.value))
            .toEqual(['auto', 'opus', 'sonnet[1m]'])
    })

    it('describes the selected model', () => {
        const { container } = render(
            <ModelSelector
                agent="claude"
                model="opus"
                options={[
                    { value: 'auto', label: 'Default' },
                    { value: 'sonnet', label: 'Sonnet', description: 'Sonnet 5 · Efficient for routine tasks' },
                    { value: 'opus', label: 'Opus', description: 'Opus 5 · Best for everyday, complex tasks' }
                ]}
                isDisabled={false}
                onModelChange={vi.fn()}
            />
        )

        // The hint under the select always describes the current selection,
        // in full, regardless of how the native picker truncates option text.
        expect(container.querySelector('[data-testid="model-description"]')?.textContent)
            .toBe('Opus 5 · Best for everyday, complex tasks')
    })

    it('shows no description for a model that has none', () => {
        const { container } = render(
            <ModelSelector
                agent="claude"
                model="sonnet"
                options={CLAUDE_OPTIONS}
                isDisabled={false}
                onModelChange={vi.fn()}
            />
        )

        expect(container.textContent).toBe('newSession.model (newSession.model.optional)DefaultSonnetOpus')
    })

    it('omits the custom entry unless it is enabled', () => {
        const { container } = render(
            <ModelSelector
                agent="claude"
                model="auto"
                options={CLAUDE_OPTIONS}
                isDisabled={false}
                onModelChange={vi.fn()}
            />
        )
        const select = container.querySelector('select') as HTMLSelectElement

        expect(Array.from(select.options).map((option) => option.value))
            .toEqual(['auto', 'sonnet', 'opus'])
        expect(container.querySelector('input')).toBeNull()
    })

    it('accepts any model id typed into the custom field', () => {
        const onModelChange = vi.fn()
        const { container } = render(
            <ModelSelector
                agent="claude"
                model="auto"
                options={CLAUDE_OPTIONS}
                allowCustomModel
                isDisabled={false}
                onModelChange={onModelChange}
            />
        )
        const select = container.querySelector('select') as HTMLSelectElement
        expect(Array.from(select.options).map((option) => option.value)).toContain('__custom__')

        fireEvent.change(select, { target: { value: '__custom__' } })
        // The sentinel must never reach the launcher as a model id.
        expect(onModelChange).not.toHaveBeenCalled()

        const input = container.querySelector('input') as HTMLInputElement
        fireEvent.change(input, { target: { value: 'claude-opus-6-20270101' } })
        expect(onModelChange).toHaveBeenCalledWith('claude-opus-6-20270101')
    })

    it('falls back to auto when the custom field is cleared', () => {
        const onModelChange = vi.fn()
        const { container } = render(
            <ModelSelector
                agent="claude"
                model="auto"
                options={CLAUDE_OPTIONS}
                allowCustomModel
                isDisabled={false}
                onModelChange={onModelChange}
            />
        )
        fireEvent.change(container.querySelector('select') as HTMLSelectElement, {
            target: { value: '__custom__' }
        })
        fireEvent.change(container.querySelector('input') as HTMLInputElement, {
            target: { value: '   ' }
        })

        expect(onModelChange).toHaveBeenCalledWith('auto')
    })

    it('renders provider-grouped options as optgroups', () => {
        const { container } = render(
            <ModelSelector
                {...baseProps}
                options={[
                    { value: 'auto', label: 'Default' },
                    { value: 'openai-codex/gpt-5.6-sol', label: 'gpt-5.6-sol', group: 'Openai-codex' },
                    { value: 'opencode-go/gpt-5.6-sol', label: 'gpt-5.6-sol', group: 'Opencode-go' },
                ]}
            />
        )
        const groups = container.querySelectorAll('optgroup')
        expect(groups).toHaveLength(2)
        expect(groups[0]?.getAttribute('label')).toBe('Openai-codex')
        expect(groups[1]?.getAttribute('label')).toBe('Opencode-go')
        // Identical labels from different providers stay distinct options.
        expect(container.querySelectorAll('option')).toHaveLength(3)
    })

    it('renders ungrouped options as plain options', () => {
        const { container } = render(
            <ModelSelector
                {...baseProps}
                options={[
                    { value: 'auto', label: 'Default' },
                    { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
                ]}
            />
        )
        expect(container.querySelectorAll('optgroup')).toHaveLength(0)
        expect(container.querySelectorAll('option')).toHaveLength(2)
    })

    it('renders nothing when options are empty', () => {
        const { container } = render(<ModelSelector {...baseProps} options={[]} />)
        expect(container.querySelector('select')).toBeNull()
    })
})
