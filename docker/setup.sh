#!/bin/sh
set -eu

repo_dir="$(unset CDPATH; cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$repo_dir"

mkdir -p data/hub data/runner data/tools data/dsh data/ssh
chmod 700 data/hub data/runner data/tools data/dsh data/ssh

ensure_env_default() {
    key="$1"
    value="$2"
    if ! grep -q "^${key}=" .env; then
        printf '%s=%s\n' "$key" "$value" >> .env
        echo "Added ${key} to .env"
    fi
}

if [ ! -f .env ]; then
    token="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
    sed "s/replace-with-a-long-random-token/${token}/" .env.example > .env
    chmod 600 .env
    echo "Created .env with a random CLI_API_TOKEN"
else
    echo ".env already exists; leaving it unchanged"
fi

ensure_env_default DSH_WEB_PORT 3080
ensure_env_default DSH_WEB_BIND_ADDRESS 0.0.0.0

echo "Bind-mount directories are ready."
echo "Edit .env, then run: docker compose up -d"
