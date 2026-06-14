# Observability Module (OBS)

**Module prefix:** OBS  
**Status:** ❌ Not started — all three are mandatory for any production deployment  
**Priority:** Mandatory across all production paths

---

## Overview

The Observability module provides the visibility needed to operate the application in production: error tracking, structured logging, and uptime monitoring. Without these, failures are invisible until a user reports them.

---

## Features

### OBS-01 — Error tracking
**Status:** ❌ Not started  
**Mandatory:** Yes

**User Story**  
As an operator, I want error tracking (Sentry) to be alerted automatically instead of inspecting the DB by hand.

**Use Cases**
1. An unhandled exception occurs in any API route or the pipeline.
2. Sentry captures the exception with stack trace, user context, and request details.
3. Operator receives an alert (email/Slack) within seconds.
4. Error includes: message, stack, affected user ID (anonymized), meeting ID, environment.
5. Dashboard shows error rate, most frequent errors, regression detection.

**Frontend**
- Client-side Sentry SDK captures React render errors and unhandled promise rejections.
- Error boundary wraps top-level routes; caught errors reported to Sentry.
- User is shown a friendly fallback UI ("Something went wrong") instead of a blank screen.

**Backend**
- `@sentry/nextjs` installed and configured.
- `SENTRY_DSN` env var set.
- All API route handlers wrapped (or using Sentry's Next.js auto-instrumentation).
- Pipeline errors caught and reported with meeting context.
- PII scrubbing: Sentry `beforeSend` hook strips audio content, transcript text from error payloads.

---

### OBS-02 — Structured logging
**Status:** ❌ Not started  
**Mandatory:** Yes

**User Story**  
As an operator, I want structured logs to trace incidents quickly.

**Use Cases**
1. Every significant pipeline event emits a structured JSON log: `{ level, timestamp, meetingId, userId, action, durationMs, ... }`.
2. API route requests are logged: method, path, status code, latency.
3. Gemini API calls are logged: model, prompt tokens, completion tokens, latency, success/failure.
4. Logs are shipped to a log aggregator (e.g., Logtail, Axiom, or stdout for self-hosted).
5. Operator can filter logs by `meetingId` or `userId` to trace a specific incident.

**Frontend**
- No user-facing logging.
- Client-side errors are handled by OBS-01 (Sentry), not structured logging.

**Backend**
- `lib/logger.ts` already exists; needs to be wired throughout the pipeline and API routes.
- Log format: JSON with fixed keys (`level`, `ts`, `service`, `meetingId`, `userId`, `msg`, `durationMs`, `error`).
- Sensitive data (transcript text, audio paths) omitted from logs.
- Pino or a lightweight JSON logger recommended (avoids `console.log` scattered everywhere).

---

### OBS-03 — Uptime monitoring & alerting
**Status:** ❌ Not started  
**Mandatory:** Yes

**User Story**  
As an operator, I want uptime monitoring + alerts to know the moment the system goes down.

**Use Cases**
1. An external uptime monitor (e.g., UptimeRobot, Checkly, Better Uptime) pings a health-check endpoint every minute.
2. `GET /api/health` returns: app status, Supabase connectivity, Gemini API connectivity.
3. If the health check fails (or the endpoint is unreachable), the operator receives an alert within 1–2 minutes.
4. The `/admin/health` page (ADM-08) consumes this endpoint to display system status.

**Frontend**
- `/admin/health` page (see ADM-08) shows current health status.
- Optional: public status page (e.g., `status.{domain}`) powered by the uptime monitor.

**Backend**
- `GET /api/health` — health check endpoint:
  - Supabase: quick `SELECT 1` query.
  - Gemini: lightweight API ping (model list or token count with tiny payload).
  - Returns: `{ status: 'ok' | 'degraded' | 'down', checks: { supabase, gemini }, uptime: ... }`.
- Should respond in < 2 seconds; timeout individual checks.
- Does NOT require authentication (uptime monitors can't authenticate).
- Should NOT expose sensitive config or credentials in the response.

---

## Implementation Order

1. **OBS-01 (Sentry)** first — catches unknown unknowns immediately.
2. **OBS-02 (Structured logging)** second — `lib/logger.ts` already scaffolded; just needs wiring.
3. **OBS-03 (Uptime)** third — `GET /api/health` is a < 1 hour task.

## Dependencies

- **OBS-01 depends on:** nothing (can be added anytime)
- **OBS-02 depends on:** nothing (lib/logger.ts exists)
- **OBS-03 depends on:** nothing; blocks ADM-08 (system health page)
- **ADM-08 depends on:** OBS-01, OBS-03
