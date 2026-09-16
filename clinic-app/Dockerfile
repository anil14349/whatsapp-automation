# Clinic portal image.
#
# Three stages so the thing that ships carries no build tooling and no source:
# the final image is the standalone server Next traces out, plus the static
# assets, on a bare Node runtime.
#
# Every setting the portal needs is read at request time rather than baked in,
# so one image serves any clinic and the same artefact can be promoted from
# staging to production unchanged. Nothing here is a NEXT_PUBLIC_ variable,
# which is what makes that possible.

# ---------- dependencies ----------
FROM node:22-alpine AS deps

WORKDIR /app

# Copied on their own so this layer is only rebuilt when the manifest changes,
# not on every source edit.
COPY package.json package-lock.json* ./

# npm ci needs a lockfile and is the reproducible path. Without one the build
# still works but resolves versions afresh, so commit a lockfile if you care
# about two builds of the same commit being identical.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---------- build ----------
FROM node:22-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Telemetry is off because a build should not phone home from a clinic's
# infrastructure.
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------- runtime ----------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# Runs as nobody in particular: a portal that reaches the database with a
# service role key should not also be root inside its own container.
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# server.js and the traced dependencies it actually needs.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Standalone deliberately leaves these out, and without them every page loads
# without styles or client JavaScript.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3001

# /login is the one route rendered without a session or a database call, so it
# answers even when Supabase is unreachable. That is the point: this checks the
# container is alive, not that the whole system is well.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:3001/login || exit 1

CMD ["node", "server.js"]
