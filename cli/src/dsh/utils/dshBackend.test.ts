import { describe, expect, it } from 'vitest'
import { resolveDshAcpCommand } from './dshBackend'

describe('resolveDshAcpCommand', () => {
    it('uses the dsh CLI with its built-in acp profile by default', () => {
        expect(resolveDshAcpCommand({})).toEqual({
            command: 'dsh',
            args: ['--profile', 'acp']
        })
    })

    it('supports a legacy config path for custom ACP servers', () => {
        expect(resolveDshAcpCommand({ HAPI_DSH_ACP_CONFIG: '/tmp/cordis.yml' })).toEqual({
            command: 'dsh',
            args: ['--config', '/tmp/cordis.yml']
        })
    })

    it('selects the acp profile for an explicit dsh executable path', () => {
        expect(resolveDshAcpCommand({
            HAPI_DSH_ACP_COMMAND: '/opt/hapi-tools/bin/dsh'
        })).toEqual({
            command: '/opt/hapi-tools/bin/dsh',
            args: ['--profile', 'acp']
        })
    })

    it('does not add dsh profile arguments to a custom ACP executable', () => {
        expect(resolveDshAcpCommand({
            HAPI_DSH_ACP_COMMAND: 'my-acp-server'
        })).toEqual({
            command: 'my-acp-server',
            args: []
        })
    })

    it('supports source checkouts and community servers through JSON args', () => {
        expect(resolveDshAcpCommand({
            HAPI_DSH_ACP_COMMAND: 'pnpm',
            HAPI_DSH_ACP_ARGS_JSON: '["--dir", "/opt/dsh", "run", "demo:acp"]'
        })).toEqual({
            command: 'pnpm',
            args: ['--dir', '/opt/dsh', 'run', 'demo:acp']
        })
    })

    it('rejects shell-like or malformed argument values', () => {
        expect(() => resolveDshAcpCommand({ HAPI_DSH_ACP_ARGS_JSON: 'pnpm --dir /opt/dsh' }))
            .toThrow('HAPI_DSH_ACP_ARGS_JSON must be a JSON array of strings')
        expect(() => resolveDshAcpCommand({ HAPI_DSH_ACP_ARGS_JSON: '["pnpm", 1]' }))
            .toThrow('HAPI_DSH_ACP_ARGS_JSON must be a JSON array of strings')
    })
})
