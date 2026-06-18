# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Multi-stage build: deps → builder → runner
#
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time.
# Pass them as --build-arg flags (see README).
#
# Server-only secrets (GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY,
# SPEECHMATICS_API_KEY) are never baked into the image — supply them at
# runtime via -e or --env-file.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: install all dependencies ────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build the Next.js app ───────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Receive public vars as build args and expose them so Next.js inlines them
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN npm run build

# ── Stage 3: production runtime — nginx (port 3333) → node (port 3000) ───────
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache nginx ffmpeg

ENV NODE_ENV=production
# Next.js standalone server reads PORT at startup
ENV PORT=3000

# Standalone output: server.js + trimmed node_modules + .next/server/
COPY --from=builder /app/.next/standalone ./
# Static client bundles (JS, CSS, fonts) — must sit at .next/static/
COPY --from=builder /app/.next/static ./.next/static
# Public directory (favicon, images, etc.)
COPY --from=builder /app/public ./public

# Nginx config: listens on 3333, reverse-proxies to Node on 3000
COPY nginx.conf /etc/nginx/nginx.conf

# Startup script: waits for Node to be ready, then starts nginx as PID 1
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 3333 3000

# start-period covers the wait-for-ready loop in start.sh (~3 s typical)
HEALTHCHECK --interval=30s --timeout=5s --start-period=35s --retries=3 \
    CMD wget -qO- http://localhost:3333/ > /dev/null || exit 1

CMD ["/start.sh"]
