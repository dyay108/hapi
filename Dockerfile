# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.4.0

FROM oven/bun:${BUN_VERSION}-debian AS build

WORKDIR /src

# Install dependencies before copying the source so dependency layers remain
# reusable when application files change.
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY cli/package.json cli/package.json
COPY docs/package.json docs/package.json
COPY hub/package.json hub/package.json
COPY relay/package.json relay/package.json
COPY shared/package.json shared/package.json
COPY web/package.json web/package.json
COPY website/package.json website/package.json


RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

COPY . .

# The compiled HAPI executable embeds its PWA and the target-specific helper
# binaries. The output is normalized so later stages are architecture-agnostic.
ARG TARGETARCH
RUN bun run download:tunwg \
    && bun run build:web \
    && cd hub \
    && bun run generate:embedded-web-assets
RUN case "${TARGETARCH}" in \
        amd64) hapi_target="bun-linux-x64-baseline" ;; \
        arm64) hapi_target="bun-linux-arm64" ;; \
        *) echo "Unsupported Docker architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && cd cli \
    && bun run scripts/build-executable.ts \
        --with-web-assets \
        --target "${hapi_target}" \
        --outdir /tmp/hapi-dist \
    && install -Dm755 "/tmp/hapi-dist/${hapi_target}/hapi" /out/hapi


FROM debian:bookworm-slim AS hub

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/hapi /usr/local/bin/hapi

ENV HOME=/root \
    HAPI_HOME=/root/.hapi \
    HAPI_LISTEN_HOST=0.0.0.0 \
    HAPI_LISTEN_PORT=3006

RUN mkdir -p /root/.hapi

EXPOSE 3006

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl --fail --silent --show-error http://127.0.0.1:3006/health >/dev/null || exit 1

ENTRYPOINT ["hapi"]
CMD ["hub", "--no-relay"]


FROM node:22-bookworm-slim AS runner

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        build-essential \
        ca-certificates \
        curl \
        dnsutils \
        fd-find \
        file \
        gh \
        git \
        git-lfs \
        iputils-ping \
        jq \
        less \
        libssl-dev \
        lsof \
        netcat-openbsd \
        openssh-client \
        patch \
        pkg-config \
        procps \
        python3 \
        python3-pip \
        python3-venv \
        ripgrep \
        rsync \
        shellcheck \
        socat \
        sqlite3 \
        tmux \
        tree \
        unzip \
        wget \
        xz-utils \
        zip \
        zstd \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && git lfs install --system \
    && corepack enable \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/hapi /usr/local/bin/hapi
COPY --chmod=755 docker/runner-entrypoint.sh /usr/local/bin/hapi-runner-entrypoint
COPY --chmod=755 docker/runner-healthcheck.sh /usr/local/bin/hapi-runner-healthcheck
COPY --chmod=755 docker/dsh-web-entrypoint.sh /usr/local/bin/hapi-dsh-web-entrypoint

# Agent CLIs and DeepSeek Harness are installed at first start into
# /opt/hapi-tools. Compose bind-mounts that path, so manual upgrades survive
# container recreation and image upgrades.
ENV HOME=/root \
    HAPI_HOME=/root/.hapi \
    HAPI_API_URL=http://hapi-hub:3006 \
    HAPI_DISABLE_VERSION_HANDOFF=1 \
    NPM_CONFIG_PREFIX=/opt/hapi-tools \
    PATH=/opt/hapi-tools/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin \
    CLAUDE_BOOTSTRAP_VERSION=latest \
    CODEX_BOOTSTRAP_VERSION=latest \
    DSH_HOME=/root/.dsh \
    DSH_BOOTSTRAP_REPO=https://github.com/deepseek-ai/deepseek-harness.git \
    DSH_BOOTSTRAP_REF=dsh-v0.1.1-rc.2 \
    DSH_INSTALL_DIR=/opt/hapi-tools/deepseek-harness \
    HAPI_DSH_ACP_COMMAND=node \
    HAPI_DSH_ACP_ARGS_JSON='["/opt/hapi-tools/deepseek-harness/packages/examples/acp-demo/lib/bin.js","--config","/opt/hapi-tools/deepseek-harness/examples/acp-agent/cordis.yml"]'

RUN mkdir -p \
        /opt/hapi-tools \
        /root/.claude \
        /root/.codex \
        /root/.dsh \
        /root/.hapi \
        /workspace

WORKDIR /workspace

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD ["hapi-runner-healthcheck"]

ENTRYPOINT ["hapi-runner-entrypoint"]
CMD ["hapi", "runner", "start-sync", "--workspace-root", "/workspace"]
