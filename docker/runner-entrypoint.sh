#!/bin/sh
set -eu

mkdir -p \
    "${HAPI_HOME:-/root/.hapi}" \
    "${NPM_CONFIG_PREFIX:-/opt/hapi-tools}" \
    /root/.claude \
    /root/.codex \
    /workspace

installed_version() {
    package_name="$1"
    node -e '
        const fs = require("fs");
        const path = require("path");
        const prefix = process.env.NPM_CONFIG_PREFIX || "/usr/local";
        const packageName = process.argv[1];
        const packageJson = path.join(prefix, "lib", "node_modules", ...packageName.split("/"), "package.json");
        if (!fs.existsSync(packageJson)) process.exit(1);
        process.stdout.write(JSON.parse(fs.readFileSync(packageJson, "utf8")).version || "");
    ' "$package_name" 2>/dev/null || true
}

ensure_npm_tool() {
    package_name="$1"
    command_name="$2"
    desired_version="$3"
    current_version="$(installed_version "$package_name")"

    if [ -n "$current_version" ] \
        && command -v "$command_name" >/dev/null 2>&1 \
        && { [ "$desired_version" = "latest" ] || [ "$current_version" = "$desired_version" ]; }; then
        echo "[hapi-runner] ${command_name} ${current_version:-installed} ready"
        return
    fi

    echo "[hapi-runner] Installing ${package_name}@${desired_version} into persistent tools directory"
    npm install --global --no-audit --no-fund "${package_name}@${desired_version}"
}

if [ "${HAPI_SKIP_AGENT_BOOTSTRAP:-0}" != "1" ]; then
    ensure_npm_tool \
        "@anthropic-ai/claude-code" \
        "claude" \
        "${CLAUDE_BOOTSTRAP_VERSION:-latest}"
    ensure_npm_tool \
        "@openai/codex" \
        "codex" \
        "${CODEX_BOOTSTRAP_VERSION:-latest}"
fi

# Container PID values can be reused after recreation. HAPI's persisted lock
# cannot distinguish that from a live runner, while Compose already guarantees
# one runner process per service.
if [ "${1:-}" = "hapi" ] \
    && [ "${2:-}" = "runner" ] \
    && [ "${3:-}" = "start-sync" ]; then
    rm -f \
        "${HAPI_HOME:-/root/.hapi}/runner.state.json" \
        "${HAPI_HOME:-/root/.hapi}/runner.state.json.lock"
fi

exec "$@"
