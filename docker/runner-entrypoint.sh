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

is_live_hapi_pid() {
    pid="$1"
    [ -n "$pid" ] || return 1
    comm="$(ps -p "$pid" -o comm= 2>/dev/null | tr -d '[:space:]' || true)"
    case "$comm" in
        hapi|hapi.exe) return 0 ;;
        *) return 1 ;;
    esac
}

# Runner control state belongs to a live process. A new container cannot
# inherit the previous container's runner, and its reused PID can belong to
# this entrypoint shell -- whose command line also contains "hapi runner
# start-sync" -- so start-sync would exit as "already running" forever.
clear_stale_runner_state() {
    state="${HAPI_HOME}/runner.state.json"
    lock="${state}.lock"
    state_pid="$(jq -r '.pid // empty' "$state" 2>/dev/null || true)"
    lock_pid="$(cat "$lock" 2>/dev/null || true)"

    if is_live_hapi_pid "$state_pid" || is_live_hapi_pid "$lock_pid"; then
        log "Runner control state still belongs to a live hapi process; leaving it untouched"
        return 0
    fi

    if [ -f "$state" ] || [ -f "$lock" ]; then
        log "Removing stale runner control state"
        rm -f "$state" "$lock"
    fi
}

: "${HAPI_HOME:=/root/.hapi}"
: "${NPM_CONFIG_PREFIX:=/opt/hapi-tools}"
: "${CLAUDE_BOOTSTRAP_VERSION:=latest}"
: "${CODEX_BOOTSTRAP_VERSION:=latest}"
# dsh is the only supported DeepSeek Harness launcher; the ACP server is its
# built-in `acp` profile. Pin an exact version because this deployment relies
# on that profile contract.
DSH_BOOTSTRAP_DEFAULT_VERSION=0.2.1-rc.2
: "${DSH_BOOTSTRAP_VERSION:=$DSH_BOOTSTRAP_DEFAULT_VERSION}"
: "${DSH_HOME:=/root/.dsh}"
: "${HAPI_DSH_ACP_COMMAND:=${NPM_CONFIG_PREFIX}/bin/dsh}"
case "${HAPI_DSH_ACP_COMMAND##*/}" in
    dsh|dsh.cmd|dsh.exe|dsh.bat)
        if is_disabled_version "$DSH_BOOTSTRAP_VERSION"; then
            log "DSH_BOOTSTRAP_VERSION=${DSH_BOOTSTRAP_VERSION} is not supported for the required dsh launcher; installing ${DSH_BOOTSTRAP_DEFAULT_VERSION}"
            DSH_BOOTSTRAP_VERSION="$DSH_BOOTSTRAP_DEFAULT_VERSION"
        fi
        ;;
esac
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

clear_stale_runner_state

install_npm_tool_if_missing "claude" "@anthropic-ai/claude-code" "$CLAUDE_BOOTSTRAP_VERSION"
install_npm_tool_if_missing "codex" "@openai/codex" "$CODEX_BOOTSTRAP_VERSION"
install_npm_tool_if_missing "dsh" "@deepseek-ai/dsh" "$DSH_BOOTSTRAP_VERSION"

case "${HAPI_DSH_ACP_COMMAND##*/}" in
    dsh|dsh.cmd|dsh.exe|dsh.bat)
        if ! command -v dsh >/dev/null 2>&1; then
            log "dsh is required for the ACP server but was not installed"
            exit 1
        fi
        ;;
esac

exec "$@"
