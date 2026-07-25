import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ClaudeModelSummary } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

/**
 * Model catalog advertised by the Claude Code CLI on the target machine.
 *
 * Discovery is best-effort: an offline machine, an older CLI, or a failed probe
 * yields an empty list, and callers merge whatever arrives with the static
 * presets (see `mergeClaudeModelOptions`) so the picker still works.
 */
export function useClaudeModels(args: {
    api: ApiClient | null
    sessionId?: string | null
    machineId?: string | null
    enabled?: boolean
}): {
    models: ClaudeModelSummary[]
    isLoading: boolean
    error: string | null
} {
    const { api, sessionId, machineId } = args
    const enabled = Boolean(args.enabled && api && (sessionId || machineId))
    const queryKey = sessionId
        ? queryKeys.sessionClaudeModels(sessionId)
        : queryKeys.machineClaudeModels(machineId ?? 'unknown')

    const query = useQuery({
        queryKey,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (sessionId) {
                return await api.getSessionClaudeModels(sessionId)
            }
            if (machineId) {
                return await api.getMachineClaudeModels(machineId)
            }
            throw new Error('Claude models target unavailable')
        },
        enabled,
        staleTime: 60_000,
        retry: false,
    })

    return {
        models: query.data?.models ?? [],
        isLoading: query.isLoading,
        error: query.data?.success === false
            ? (query.data.error ?? 'Failed to load Claude models')
            : query.error instanceof Error
                ? query.error.message
                : query.error
                    ? 'Failed to load Claude models'
                    : null,
    }
}
