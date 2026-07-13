# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Multi-stage build: deps → builder → runner
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time.
# Server-only secrets are supplied at runtime (never baked).
# ─────────────────────────────────────────────────────────────────────────────



# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci



# ── Stage 2: build the Next.js app ───────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build



# ── Stage 3: production runtime — nginx (port 80) → node (port 3000) ──────────
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache nginx ffmpeg
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js standalone server reads PORT at startup (internal, behind nginx)
ENV PORT=3000



COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/ai-instruction/ai-gen ./ai-instruction/ai-gen



# Nginx: reverse-proxy from 80 → Node 3000
COPY nginx.conf /etc/nginx/nginx.conf
COPY start.sh /start.sh
RUN chmod +x /start.sh



EXPOSE 80



# start-period covers the Node startup wait in start.sh (~3s typical)
HEALTHCHECK --interval=30s --timeout=5s --start-period=35s --retries=3 \
    CMD wget -qO- http://localhost:80/ > /dev/null || exit 1



CMD ["/start.sh"]
 