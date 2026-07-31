# Ported from ../../../video-agents/military/Dockerfile, minus the Codex CLI —
# no call volume here justifies the subscription backend (agents/CLAUDE.md,
# "Cost"), so there is no /data volume and no entrypoint script either.
#
# Railway builds this service from this file. It needs a system python for the
# agents/ subprocesses, and the build gate below runs them, so a broken python
# layer fails the BUILD rather than every job at runtime.
#
# The ingest worker (lib/jobs/worker.ts) is an in-process drain loop that needs a
# long-lived server; `npm run start` gives it one.
# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# public/ is ~66MB, nearly all of it public/overlays + public/sound-effects, which
# the Next app never serves — render-modal/modal_app.py pulls them straight from
# the repo at Modal-deploy time. Copied wholesale anyway: an exclusion here would
# break silently the day someone adds a served asset under those paths, and the
# image is pulled once per deploy.
COPY --from=builder /app/public ./public

# Python agents, invoked as subprocesses by lib/agents/bridge.ts. requirements
# copied first so the pip layer caches across agent code edits.
# --break-system-packages: the container IS the sandbox (bookworm marks its
# python externally-managed, PEP 668).
COPY --from=builder /app/agents/requirements.txt ./agents/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r agents/requirements.txt
RUN python3 -c "import openai; print('[build] openai', openai.__version__)"
COPY --from=builder /app/agents ./agents

# Fail the BUILD, not production. A broken python layer would otherwise surface
# as every job failing at runtime. The image is immutable, so passing here means
# passing in prod — that makes this gate the primary guarantee. Keep it strict.
#
# Runs the exact command lib/agents/bridge.ts spawns, from the same cwd, on an
# EMPTY payload. Every agent returns before any model call when its input is
# empty (agents/CLAUDE.md), so this is offline, keyless, fast and deterministic —
# it verifies the import graph, the cwd and the stdout contract.
#
# `set -e` + `-o pipefail` so a nonzero exit from python fails the build even
# though its stdout is piped; the python assert also rejects exit-0-with-garbage
# (a stray print() on the deterministic path — the classic silent-death bug).
#
# EVERY NEW AGENT ADDS A LINE HERE.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN set -e \
    && cd agents \
    && echo '{"script":""}' | python3 -m script_context \
        | python3 -c "import json,sys; d=json.load(sys.stdin); assert d.get('summary')=='' and d.get('genre'), d; print('[build] script_context OK')" \
    && echo '{"chunk_text":""}' | python3 -m scene_splitter \
        | python3 -c "import json,sys; d=json.load(sys.stdin); assert d.get('snippets')==[], d; print('[build] scene_splitter OK')" \
    && echo '{"scenes":[]}' | python3 -m scene_director \
        | python3 -c "import json,sys; d=json.load(sys.stdin); assert d.get('scenes')==[], d; print('[build] scene_director OK')"

# The deterministic checks, run at build time for the same reason: they need no
# key and no network, so there is no excuse for them to be green only on a laptop.
RUN set -e \
    && cd agents \
    && for a in script_context scene_splitter scene_director; do python3 $a/test_$a.py; done
SHELL ["/bin/sh", "-c"]

EXPOSE 8080
CMD ["npm", "run", "start"]
