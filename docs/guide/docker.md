# Docker

The repository includes separate images for the HAPI hub and runner:

- `ghcr.io/dyay108/hapi-hub` serves the API, SQLite database, and embedded PWA.
- `ghcr.io/dyay108/hapi-runner` launches Claude Code and Codex sessions.

The runner intentionally runs as root. This lets it reuse root-owned Claude and
Codex credentials from the host without changing ownership or copying tokens.
The hub and runner use separate HAPI data directories so the runner lock and
machine identity never collide with the hub database.

## Set up bind mounts

From the repository root:

```bash
./docker/setup.sh
```

This creates:

```text
data/
├── hub/       # Hub settings, keys, and SQLite database
├── runner/    # Runner machine identity, state, and logs
├── tools/     # Persistent Claude Code and Codex npm installations
└── ssh/       # Optional dedicated Git deploy keys
```

It also creates an ignored `.env` file with a random `CLI_API_TOKEN`. Edit
`HAPI_PUBLIC_URL` and `CORS_ORIGINS` in that file before starting the services.

The Compose file additionally bind-mounts:

- `/root/.claude` to `/root/.claude`
- `/root/.codex` to `/root/.codex`
- `/root/projects` to `/workspace`

Both credential directories must already exist on the host.

## Start HAPI

Build the fork locally:

```bash
docker compose up -d --build
```

Or use published GHCR images:

```bash
docker compose pull
docker compose up -d --no-build
```

Inspect startup and retrieve the configured URL:

```bash
docker compose logs -f hapi-hub hapi-runner
docker compose ps
```

The default host boundary is `127.0.0.1:3006`. Put an HTTPS reverse proxy in
front of that address. HAPI's WebSocket and SSE endpoints must not be buffered.
For Caddy:

```text
hapi.example.com {
    reverse_proxy 127.0.0.1:3006 {
        flush_interval -1
    }
}
```

Open `HAPI_PUBLIC_URL` on Android and enter the same `CLI_API_TOKEN` stored in
`.env`. The PWA can then be added to the home screen.

## Update Claude Code and Codex

The npm prefix is `/opt/hapi-tools`, backed by `./data/tools`. Updates therefore
survive restarts, container recreation, and image upgrades:

```bash
docker compose exec hapi-runner \
  npm install --global @anthropic-ai/claude-code@latest @openai/codex@latest
```

Confirm the active versions:

```bash
docker compose exec hapi-runner claude --version
docker compose exec hapi-runner codex --version
```

With `CLAUDE_BOOTSTRAP_VERSION=latest` and `CODEX_BOOTSTRAP_VERSION=latest`, the
entrypoint only installs missing tools; it does not downgrade manual updates.
Setting an exact version in `.env` enforces that version on every restart.

## Authenticate

The runner reads the same `/root/.claude` and `/root/.codex` bind mounts as the
host. You can authenticate from the host or interactively inside the runner:

```bash
docker compose run --rm hapi-runner claude
docker compose run --rm hapi-runner codex login
```

Do not run concurrent sessions from multiple containers against the same
project checkout unless you are comfortable with both processes editing it.

## Optional Git SSH access

Copy only a dedicated deploy key and a prepared `known_hosts` file into
`data/ssh`. The directory is mounted read-only:

```bash
ssh-keyscan github.com > data/ssh/known_hosts
chmod 600 data/ssh/*
```

Avoid mounting the host's complete `/root/.ssh` directory into remotely
controlled coding sessions.
