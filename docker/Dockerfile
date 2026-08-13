# Multi-stage build — supports running BOTH the Next.js web server
# (CMD default) AND the BullMQ worker (override CMD to `pnpm worker`)
# from the same image. For Coolify we deploy the same image twice with
# different start commands.

# syntax=docker/dockerfile:1.6
# glibc base, NOT Alpine — this is load-bearing.
#
# onnxruntime-node (pulled in by @xenova/transformers for product embeddings)
# ships a prebuilt binary linked against glibc. On Alpine/musl it loads via
# gcompat but then aborts at inference time:
#
#   terminate called after throwing an instance of 'Ort::Exception'
#     what():  Exception caught: No error information
#
# That throw happens in C++, below JS, so the worker's try/catch cannot catch
# it — the process dies with SIGABRT and every product is written WITHOUT a
# vector, silently disabling semantic gap matching. The musl shims
# (libc6-compat/gcompat/libstdc++/libgomp) were tried first and are not
# sufficient; upstream does not support musl. See lib/ingestion/embed-worker.mjs.
FROM node:20-bookworm-slim AS base
# openssl: required at runtime by Prisma's query engine.
# ca-certificates: TLS for the model download from the HuggingFace CDN.
# libgomp1: OpenMP runtime that onnxruntime-node links against.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
# Pin pnpm store to a known path so BuildKit cache mounts can target it
# directly (default lives under $HOME which moves with USER directives).
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN pnpm config set store-dir /pnpm/store
WORKDIR /app

# ---- deps (full, includes devDependencies for build) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
# BuildKit cache mount on the pnpm store: every package downloaded by any
# previous build is reused here. First cold build still pays full price
# (~19min on this VPS); every subsequent build drops to ~1-2min for install.
# `--prod=false` forces pnpm to install devDependencies even when Coolify
# injects NODE_ENV=production via build ARGs.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod=false --network-concurrency=3 || \
    pnpm install --prod=false --network-concurrency=3

# ---- prod-deps (production-only, smaller — used by the runner stage) ----
# Builds FROM the deps stage (sequential, not parallel) and just prunes the
# devDependencies away. Running deps + prod-deps as two parallel `pnpm
# install` invocations was OOM-killing the build container on this 15GB
# VPS while it tried to unpack ~1300 packages twice simultaneously.
FROM deps AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm prune --prod

# ---- build ----
FROM base AS builder

# Next.js evaluates route modules at build time (for sitemap.xml, static
# metadata, etc.). Those modules import lib/env.ts, which validates env
# vars via Zod and throws on missing. Coolify passes env vars as build
# ARGs — we must declare them here so the Zod validator sees real values.
# Declaring them as ENV (not just ARG) so nested shell commands see them.
ARG SHOPIFY_API_KEY
ARG SHOPIFY_API_SECRET
ARG SHOPIFY_APP_URL
ARG SHOPIFY_SCOPES
ARG DATABASE_URL
ARG REDIS_URL
ARG SESSION_SECRET
ARG NODE_ENV=production
ARG LOG_LEVEL=info
ARG FROM_EMAIL
ARG SUPPORT_EMAIL
ARG COMPANY_ADDRESS
ARG PRIVACY_CONTACT_EMAIL

ENV SHOPIFY_API_KEY=$SHOPIFY_API_KEY \
    SHOPIFY_API_SECRET=$SHOPIFY_API_SECRET \
    SHOPIFY_APP_URL=$SHOPIFY_APP_URL \
    SHOPIFY_SCOPES=$SHOPIFY_SCOPES \
    DATABASE_URL=$DATABASE_URL \
    REDIS_URL=$REDIS_URL \
    SESSION_SECRET=$SESSION_SECRET \
    NODE_ENV=$NODE_ENV \
    LOG_LEVEL=$LOG_LEVEL \
    FROM_EMAIL=$FROM_EMAIL \
    SUPPORT_EMAIL=$SUPPORT_EMAIL \
    COMPANY_ADDRESS=$COMPANY_ADDRESS \
    PRIVACY_CONTACT_EMAIL=$PRIVACY_CONTACT_EMAIL

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
# Bump Node heap — Next's build (especially trace collection) spikes memory
# and Alpine's default ~1.7GB V8 limit was triggering OOM kills on our host.
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm build

# ---- runtime ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

# Debian's shadow tools, not Alpine's busybox addgroup/adduser.
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m -s /bin/sh nextjs

# Writable model cache for @xenova/transformers. The 90MB MiniLM model is
# fetched on first embed and cached here; without a directory the runtime user
# owns, the download fails and embeddings silently fall back to zero vectors.
ENV TRANSFORMERS_CACHE=/app/.cache/transformers
RUN mkdir -p /app/.cache/transformers && chown -R nextjs:nodejs /app/.cache

# Production-only node_modules (from the prod-deps stage) — excludes
# devDependencies to keep the image small.
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
# /app/public is optional — Next serves static assets from there if present.
# We don't ship any yet, so the folder doesn't exist in the repo and we skip
# the COPY. Add `public/.gitkeep` and re-enable this line when you have assets.
# COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/jobs ./jobs
COPY --from=builder --chown=nextjs:nodejs /app/lib ./lib
COPY --from=builder --chown=nextjs:nodejs /app/server ./server
COPY --from=builder --chown=nextjs:nodejs /app/data ./data
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.mjs ./next.config.mjs

# Regenerate Prisma client against prod-deps node_modules — the client
# files written by `prisma generate` in the builder live under that
# stage's node_modules tree; rather than hunt them via fragile globs, we
# just run generate again here. Fast (~2s), idempotent, bulletproof.
RUN ./node_modules/.bin/prisma generate

COPY --from=builder --chown=nextjs:nodejs /app/scripts/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER nextjs
EXPOSE 3000

# Entrypoint dispatches on APP_MODE env var: "web" (default) runs Next.js,
# "worker" runs the BullMQ worker. Same image, two deployments.
CMD ["/app/entrypoint.sh"]
