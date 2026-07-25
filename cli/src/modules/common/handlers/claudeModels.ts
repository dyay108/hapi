import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { logger } from '@/ui/logger'
import { listClaudeModels, type ListClaudeModelsResponse } from '../claudeModels'

export function registerClaudeModelHandlers(
    rpcHandlerManager: RpcHandlerManager,
    workingDirectory: string
): void {
    rpcHandlerManager.registerHandler<Record<string, never>, ListClaudeModelsResponse>(
        RPC_METHODS.ListClaudeModels,
        async () => {
            logger.debug('List Claude models request')
            return await listClaudeModels(workingDirectory)
        }
    )
}
