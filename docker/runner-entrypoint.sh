#!/bin/sh
set -eu

mkdir -p \
    "${HAPI_HOME:-/root/.hapi}" \
    "${NPM_CONFIG_PREFIX:-/opt/hapi-tools}" \
    "${DSH_HOME:-/root/.dsh}" \
    /root/.claude \
    /root/.codex \
    /workspace

bootstrap_lock_dir="${NPM_CONFIG_PREFIX:-/opt/hapi-tools}/.bootstrap.lock"

acquire_bootstrap_lock() {
    while ! mkdir "$bootstrap_lock_dir" 2>/dev/null; do
        echo "[hapi-runner] Waiting for tools bootstrap lock"
        sleep 2
    done
    trap 'rm -rf "$bootstrap_lock_dir"' EXIT
}

release_bootstrap_lock() {
    rm -rf "$bootstrap_lock_dir"
    trap - EXIT
}

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

ensure_deepseek_harness() {
    install_dir="${DSH_INSTALL_DIR:-/opt/hapi-tools/deepseek-harness}"
    repo="${DSH_BOOTSTRAP_REPO:-https://github.com/deepseek-ai/deepseek-harness.git}"
    ref="${DSH_BOOTSTRAP_REF:-dsh-v0.1.1-rc.2}"

    if [ ! -d "${install_dir}/.git" ]; then
        echo "[hapi-runner] Installing DeepSeek Harness ${ref} into ${install_dir}"
        rm -rf "$install_dir"
        git clone --depth 1 --branch "$ref" "$repo" "$install_dir"
    fi

    if [ ! -d "${install_dir}/node_modules" ]; then
        echo "[hapi-runner] Installing DeepSeek Harness dependencies"
        (cd "$install_dir" && pnpm install --frozen-lockfile)
    fi

    if [ ! -e "${install_dir}/apps/cli/lib/bin.js" ]; then
        echo "[hapi-runner] Building DeepSeek Harness"
        (cd "$install_dir" && pnpm run build)
    fi
}

if [ "${HAPI_SKIP_AGENT_BOOTSTRAP:-0}" != "1" ]; then
    acquire_bootstrap_lock
    ensure_npm_tool \
        "@anthropic-ai/claude-code" \
        "claude" \
        "${CLAUDE_BOOTSTRAP_VERSION:-latest}"
    ensure_npm_tool \
        "@openai/codex" \
        "codex" \
        "${CODEX_BOOTSTRAP_VERSION:-latest}"
    ensure_deepseek_harness
    release_bootstrap_lock
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
