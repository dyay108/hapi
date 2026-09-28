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
export HAPI_HOME NPM_CONFIG_PREFIX

case ":${PATH:-}:" in
    *":${NPM_CONFIG_PREFIX}/bin:"*) ;;
    *) PATH="${NPM_CONFIG_PREFIX}/bin:${PATH:-}"; export PATH ;;
esac

mkdir -p \
    "$HAPI_HOME" \
    "$NPM_CONFIG_PREFIX" \
    /root/.claude \
    /root/.codex \
    /workspace

install_npm_tool_if_missing "claude" "@anthropic-ai/claude-code" "$CLAUDE_BOOTSTRAP_VERSION"
install_npm_tool_if_missing "codex" "@openai/codex" "$CODEX_BOOTSTRAP_VERSION"

exec "$@"
