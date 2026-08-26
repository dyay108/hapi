#!/bin/sh
set -eu

: "${DSH_WEB_PORT:?DSH_WEB_PORT must be set}"

external_port="$DSH_WEB_PORT"
bind_address="${DSH_WEB_BIND_ADDRESS:-0.0.0.0}"

case "$external_port" in
    '' | *[!0-9]*)
        echo "[dsh-web] DSH_WEB_PORT must be numeric" >&2
        exit 1
        ;;
esac

if [ "$external_port" -lt 1 ] || [ "$external_port" -gt 65535 ]; then
    echo "[dsh-web] DSH_WEB_PORT must be between 1 and 65535" >&2
    exit 1
fi

if [ -n "${DSH_WEB_INTERNAL_PORT:-}" ]; then
    internal_port="$DSH_WEB_INTERNAL_PORT"
    case "$internal_port" in
        '' | *[!0-9]*)
            echo "[dsh-web] DSH_WEB_INTERNAL_PORT must be numeric" >&2
            exit 1
            ;;
    esac
else
    if [ "$external_port" -lt 55536 ]; then
        internal_port=$((external_port + 10000))
    else
        internal_port=$((external_port - 10000))
    fi
fi

if [ "$internal_port" -lt 1 ] || [ "$internal_port" -gt 65535 ]; then
    echo "[dsh-web] DSH_WEB_INTERNAL_PORT must be between 1 and 65535" >&2
    exit 1
fi

if [ "$external_port" = "$internal_port" ]; then
    echo "[dsh-web] DSH_WEB_PORT and DSH_WEB_INTERNAL_PORT must differ" >&2
    exit 1
fi

cleanup() {
    if [ -n "${forwarder_pid:-}" ]; then
        kill "$forwarder_pid" 2>/dev/null || true
    fi
}
trap cleanup INT TERM EXIT

socat \
    "TCP-LISTEN:${external_port},fork,reuseaddr,bind=${bind_address}" \
    "TCP:127.0.0.1:${internal_port}" &
forwarder_pid="$!"

install_dir="${DSH_INSTALL_DIR:-/opt/hapi-tools/deepseek-harness}"
cd "$install_dir"

set -- pnpm dsh web \
    --host 127.0.0.1 \
    --port "$internal_port" \
    --trusted-host "127.0.0.1:${external_port}" \
    --trusted-host "localhost:${external_port}" \
    --no-open

if [ -n "${DSH_WEB_TRUSTED_HOSTS:-}" ]; then
    old_ifs="$IFS"
    IFS=","
    for trusted_host in $DSH_WEB_TRUSTED_HOSTS; do
        if [ -n "$trusted_host" ]; then
            set -- "$@" --trusted-host "$trusted_host"
        fi
    done
    IFS="$old_ifs"
fi

exec "$@"
