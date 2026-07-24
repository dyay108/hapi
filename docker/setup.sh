#!/bin/sh
set -eu

repo_dir="$(unset CDPATH; cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$repo_dir"

mkdir -p data/hub data/runner data/tools data/ssh
chmod 700 data/hub data/runner data/tools data/ssh

if [ ! -f .env ]; then
    token="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
    sed "s/replace-with-a-long-random-token/${token}/" .env.example > .env
    chmod 600 .env
    echo "Created .env with a random CLI_API_TOKEN"
else
    echo ".env already exists; leaving it unchanged"
fi

echo "Bind-mount directories are ready."
echo "Edit .env, then run: docker compose up -d"
