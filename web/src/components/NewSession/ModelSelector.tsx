import { useState } from 'react'
import type { AgentType } from './types'
import { MODEL_OPTIONS } from './types'
import { useTranslation } from '@/lib/use-translation'

/** Sentinel select value; never sent to the agent. */
const CUSTOM_OPTION_VALUE = '__custom__'

export function ModelSelector(props: {
    agent: AgentType
    model: string
    label?: string
    options?: Array<{ value: string; label: string; description?: string }>
    /** Adds a free-text entry so any model id the agent accepts can be launched. */
    allowCustomModel?: boolean
    isDisabled: boolean
    isLoading?: boolean
    error?: string | null
    onModelChange: (value: string) => void
}) {
    const { t } = useTranslation()
    const [isCustomSelected, setIsCustomSelected] = useState(false)
    const options: Array<{ value: string; label: string; description?: string }> =
        props.options ?? MODEL_OPTIONS[props.agent]
    if (options.length === 0) {
        return null
    }

    const showCustomInput = Boolean(props.allowCustomModel) && isCustomSelected
    const isDisabled = props.isDisabled || props.isLoading
    // A <select> can only render one line per option, so describe the chosen
    // model underneath it instead.
    const selectedDescription = showCustomInput
        ? null
        : options.find((option) => option.value === props.model)?.description ?? null

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {props.label ?? t('newSession.model')}{' '}
                {!props.label ? (
                    <span className="font-normal">({t('newSession.model.optional')})</span>
                ) : null}
            </label>
            <select
                value={showCustomInput ? CUSTOM_OPTION_VALUE : props.model}
                onChange={(e) => {
                    if (e.target.value === CUSTOM_OPTION_VALUE) {
                        setIsCustomSelected(true)
                        return
                    }
                    setIsCustomSelected(false)
                    props.onModelChange(e.target.value)
                }}
                disabled={isDisabled}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
            >
                {options.map((option) => (
                    // A native <option> is plain text, so the description is
                    // folded into the label — otherwise it is invisible at the
                    // moment the user is actually choosing.
                    <option key={option.value} value={option.value}>
                        {option.description ? `${option.label} — ${option.description}` : option.label}
                    </option>
                ))}
                {props.allowCustomModel ? (
                    <option value={CUSTOM_OPTION_VALUE}>{t('newSession.model.custom')}</option>
                ) : null}
            </select>
            {selectedDescription ? (
                <div className="text-xs text-[var(--app-hint)]" data-testid="model-description">
                    {selectedDescription}
                </div>
            ) : null}
            {showCustomInput ? (
                <>
                    <input
                        type="text"
                        autoFocus
                        spellCheck={false}
                        autoCapitalize="none"
                        autoCorrect="off"
                        value={props.model === 'auto' ? '' : props.model}
                        placeholder={t('newSession.model.customPlaceholder')}
                        disabled={isDisabled}
                        onChange={(e) => props.onModelChange(e.target.value.trim() || 'auto')}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    />
                    <div className="text-xs text-[var(--app-hint)]">
                        {t('newSession.model.customHint')}
                    </div>
                </>
            ) : null}
            {props.error ? (
                <div className="text-xs text-red-600">
                    {props.error}
                </div>
            ) : null}
        </div>
    )
}
