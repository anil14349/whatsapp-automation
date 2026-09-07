# syntax=docker/dockerfile:1

# ============================================================
# clinic-app Docker image — multi-stage build using Next.js's
# "standalone" output (see next.config.mjs's `output: "standalone"`),
# which traces only the node_modules actually used at runtime instead
# of shipping the whole dev dependency tree.
#
# NOT built or run in the sandbox this was authored in (no reachable
# Docker daemon there — see clinic-app/README.md "Deploying" for the
# verification status). Build it yourself before relying on it:
#   docker build -t clinic-app .
#   docker run --env-file .env.local -p 3000:3000 clinic-app
# ============================================================

FROM node:20-slim AS base

# ------------------------------------------------------------------
FROM base AS deps
WORKDIR /app

# Deliberately NOT copying .npmrc — it sets strict-ssl=false, a
# workaround for a broken CA bundle in the sandbox this project was
# first scaffolded in (see the file's own comment), not something that
# should silently disable TLS verification for your build environment
# too. If your own network needs it, pass it explicitly instead of
# relying on this image doing it for you.
COPY package.json package-lock.json ./
RUN npm ci

# ------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Not currently required: every /admin/* page reads cookies() (auth)
# and the webhook route is a dynamic API route, so Next never tries to
# statically prerender anything that would call getServerEnv() (lib/
# env.ts's zod schema, which throws on missing vars) during the build —
# confirmed by `npm run build` succeeding with zero env vars set at all.
# Set anyway as a safety net: if a future page becomes statically
# prerenderable and reads settings at build time, this prevents a
# confusing "env var missing" build failure. Never used at runtime —
# `docker run --env-file` supplies the real values.
ENV NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="build-placeholder" \
    SUPABASE_SERVICE_ROLE_KEY="build-placeholder" \
    WHATSAPP_ACCESS_TOKEN="build-placeholder" \
    WHATSAPP_PHONE_NUMBER_ID="build-placeholder" \
    WHATSAPP_VERIFY_TOKEN="build-placeholder" \
    WHATSAPP_WEBHOOK_POST_TOKEN="build-placeholder" \
    ADMIN_SESSION_SECRET="build-placeholder-build-placeholder-32ch"

RUN npm run build

# ------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
