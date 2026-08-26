# Docker

The repository includes separate images for the HAPI hub and runner:

- `ghcr.io/dyay108/hapi-hub` serves the API, SQLite database, and embedded PWA.
- `ghcr.io/dyay108/hapi-runner` launches Claude Code, Codex, and DeepSeek
  Harness sessions.

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
├── tools/     # Persistent agent tools and DeepSeek Harness checkout
├── dsh/       # DeepSeek Harness profiles, settings, and session state
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

## Update agent tools

The npm prefix is `/opt/hapi-tools`, backed by `./data/tools`. Claude Code,
Codex, and the DeepSeek Harness source checkout live there, so updates survive
restarts, container recreation, and image upgrades:

```bash
docker compose exec hapi-runner \
  npm install --global @anthropic-ai/claude-code@latest @openai/codex@latest
```

Confirm the active versions:

```bash
docker compose exec hapi-runner claude --version
docker compose exec hapi-runner codex --version
docker compose exec hapi-runner \
  sh -lc 'cd /opt/hapi-tools/deepseek-harness && git describe --tags --always'
```

With `CLAUDE_BOOTSTRAP_VERSION=latest` and `CODEX_BOOTSTRAP_VERSION=latest`, the
entrypoint only installs missing tools; it does not downgrade manual updates.
Setting an exact version in `.env` enforces that version on every restart.

DeepSeek Harness is bootstrapped from `DSH_BOOTSTRAP_REPO` at
`DSH_BOOTSTRAP_REF` only when `./data/tools/deepseek-harness` is missing. To
upgrade it manually:

```bash
docker compose exec hapi-runner sh -lc '
  cd /opt/hapi-tools/deepseek-harness
  git fetch --tags
  git checkout dsh-v0.1.1-rc.2
  pnpm install --frozen-lockfile
  pnpm run build
'
```

The runner exports `HAPI_DSH_ACP_COMMAND=node` and points
`HAPI_DSH_ACP_ARGS_JSON` at the built `dsh-acp-demo` bin plus the source
checkout's `examples/acp-agent/cordis.yml`, so HAPI-created DeepSeek Harness
sessions use the built source checkout without letting package-manager output
touch the ACP stdout stream.

## DeepSeek Harness Web UI

Compose starts `deepseek-harness` alongside the HAPI runner. It runs
`dsh web --no-open` inside the runner image and publishes it on
`${DSH_WEB_BIND_ADDRESS}:${DSH_WEB_PORT}`. The default `.env.example` binds
`0.0.0.0` on port `3080`; set `DSH_WEB_BIND_ADDRESS=127.0.0.1` to keep it
loopback-only:

```bash
docker compose ps deepseek-harness
docker compose logs -f deepseek-harness
```

Open `http://<docker-host>:${DSH_WEB_PORT}`. DSH intentionally keeps its server
on loopback inside the container; the container uses a local TCP forwarder so
Docker can publish the configured host bind address and port without asking DSH
itself to bind every interface.
`DSH_WEB_INTERNAL_PORT` is optional and only controls the private loopback port
used inside the container. For a reverse proxy or a different browser host, set
`DSH_WEB_TRUSTED_HOSTS` to a comma-separated list of `host:port` authorities.

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
