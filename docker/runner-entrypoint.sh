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

# The DSH ACP server resolves its plugin tree relative to its own install
# directory, and the composition names ~26 leaf plugins that are not
# dependencies of the server package. So it gets a self-contained npm root
# rather than a global install. The root lives under NPM_CONFIG_PREFIX because
# Compose bind-mounts that path, so the install survives container recreation.
#
# The composition itself lives at $HAPI_DSH_ACP_CONFIG (DSH_HOME by default),
# deliberately apart from the npm root: that is the file HAPI hands the server
# as --config, so seeding and provisioning from exactly that path keeps the
# installed plugins in step with the config actually in use.
install_dsh_acp_root() {
    version="$1"
    root="$2"
    config="$3"
    template="$4"

    if is_disabled_version "$version"; then
        log "Skipping DSH ACP bootstrap"
        return 0
    fi

    # The composition is user-editable once seeded: an edited copy is never
    # overwritten, and editing it re-triggers the install below so newly
    # referenced plugins get fetched.
    if [ ! -f "$config" ]; then
        if [ ! -f "$template" ]; then
            log "No DSH composition at ${config} and no template at ${template}; skipping bootstrap"
            return 0
        fi
        log "Seeding DSH composition at ${config}"
        mkdir -p "$(dirname "$config")"
        cp "$template" "$config"
    fi

    mkdir -p "$root"
    stamp="$root/.bootstrap-stamp"
    want="${version} $(sha256sum "$config" | cut -d' ' -f1)"
    if [ -x "$root/node_modules/.bin/dsh-acp-demo" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$want" ]; then
        log "DSH ACP root already provisioned at ${root}"
        return 0
    fi

    packages="$(grep -oE '@deepseek-ai/[a-z0-9-]+' "$config" | sort -u | sed "s|\$|@${version}|" | tr '\n' ' ')"
    if [ -z "$packages" ]; then
        log "No @deepseek-ai plugins referenced in ${config}; skipping bootstrap"
        return 0
    fi

    [ -f "$root/package.json" ] || printf '{"name":"hapi-dsh-acp","private":true}\n' >"$root/package.json"

    log "Installing DSH ACP composition (${version}) from ${config} into ${root}"
    # --prefix keeps this local to $root despite the global NPM_CONFIG_PREFIX.
    # shellcheck disable=SC2086
    npm install --prefix "$root" $packages --registry=https://registry.npmjs.org --no-audit --no-fund
    printf '%s\n' "$want" >"$stamp"
}

: "${HAPI_HOME:=/root/.hapi}"
: "${NPM_CONFIG_PREFIX:=/opt/hapi-tools}"
: "${CLAUDE_BOOTSTRAP_VERSION:=latest}"
: "${CODEX_BOOTSTRAP_VERSION:=latest}"
# DeepSeek publishes the ACP server only under the `next` dist-tag; its `latest`
# tag still points at 0.0.1-rc.1, so this bootstrap pins an exact version. The
# leaf plugins are installed at the same version as the server.
: "${DSH_ACP_BOOTSTRAP_VERSION:=0.1.1-rc.2}"
: "${DSH_HOME:=/root/.dsh}"
: "${DSH_ACP_ROOT:=${NPM_CONFIG_PREFIX}/dsh-acp}"
: "${DSH_ACP_COMPOSITION_TEMPLATE:=/opt/hapi-dsh/cordis.yml}"
: "${HAPI_DSH_ACP_CONFIG:=${DSH_HOME}/cordis.yml}"
: "${HAPI_DSH_ACP_COMMAND:=${DSH_ACP_ROOT}/node_modules/.bin/dsh-acp-demo}"
: "${DSH_BOOTSTRAP_VERSION:=skip}"
export HAPI_HOME NPM_CONFIG_PREFIX DSH_HOME DSH_ACP_ROOT
export HAPI_DSH_ACP_CONFIG HAPI_DSH_ACP_COMMAND

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
install_dsh_acp_root "$DSH_ACP_BOOTSTRAP_VERSION" "$DSH_ACP_ROOT" \
    "$HAPI_DSH_ACP_CONFIG" "$DSH_ACP_COMPOSITION_TEMPLATE"

exec "$@"
