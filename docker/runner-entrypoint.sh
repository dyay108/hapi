#!/usr/bin/env sh
set -eu

log() {
    printf '[hapi-runner-entrypoint] %s\n' "$*"
}

is_disabled_version() {
    case "${1:-}" in
        ""|0|false|False|FALSE|no|No|NO|none|None|NONE|skip|Skip|SKIP)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

install_npm_tool_if_missing() {
    command_name="$1"
    package_name="$2"
    version="$3"

    if is_disabled_version "$version"; then
        log "Skipping ${command_name} bootstrap"
        return 0
    fi

    if command -v "$command_name" >/dev/null 2>&1; then
        log "${command_name} already available at $(command -v "$command_name")"
        return 0
    fi

    log "Installing ${package_name}@${version}"
    npm install -g "${package_name}@${version}" --registry=https://registry.npmjs.org
}

: "${HAPI_HOME:=/root/.hapi}"
: "${NPM_CONFIG_PREFIX:=/opt/hapi-tools}"
: "${CLAUDE_BOOTSTRAP_VERSION:=latest}"
: "${CODEX_BOOTSTRAP_VERSION:=latest}"
# dsh is the only supported DeepSeek Harness launcher; the ACP server is its
# built-in `acp` profile. Pin an exact version because this deployment relies
# on that profile contract.
: "${DSH_BOOTSTRAP_VERSION:=0.2.1-rc.2}"
: "${DSH_HOME:=/root/.dsh}"
: "${HAPI_DSH_ACP_COMMAND:=${NPM_CONFIG_PREFIX}/bin/dsh}"
if [ -z "${HAPI_DSH_ACP_ARGS_JSON:-}" ]; then
    HAPI_DSH_ACP_ARGS_JSON='["--profile","acp"]'
fi
export HAPI_HOME NPM_CONFIG_PREFIX DSH_HOME
export HAPI_DSH_ACP_COMMAND HAPI_DSH_ACP_ARGS_JSON

case ":${PATH:-}:" in
    *":${NPM_CONFIG_PREFIX}/bin:"*) ;;
    *) PATH="${NPM_CONFIG_PREFIX}/bin:${PATH:-}"; export PATH ;;
esac

mkdir -p \
    "$HAPI_HOME" \
    "$NPM_CONFIG_PREFIX" \
    /root/.claude \
    /root/.codex \
    /root/.dsh \
    /workspace

install_npm_tool_if_missing "claude" "@anthropic-ai/claude-code" "$CLAUDE_BOOTSTRAP_VERSION"
install_npm_tool_if_missing "codex" "@openai/codex" "$CODEX_BOOTSTRAP_VERSION"
install_npm_tool_if_missing "dsh" "@deepseek-ai/dsh" "$DSH_BOOTSTRAP_VERSION"

exec "$@"
