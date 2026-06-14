# DevOps Module (OPS)

**Module prefix:** OPS  
**Status:** ❌ Not started — all three are mandatory for production  
**Priority:** Mandatory for any production deployment

---

## Overview

The DevOps module establishes the automated infrastructure needed to safely deploy and operate the application: CI/CD with automated tests, a staging environment, and database backup. Without these, every deploy is a manual gamble and a single DB incident could be unrecoverable.

---

## Features

### OPS-01 — CI + automated tests
**Status:** ❌ Not started  
**Mandatory:** Yes

**User Story**  
As a developer, I want automated tests to run before deploy to catch bugs early.

**Use Cases**
1. Developer pushes a branch or opens a PR.
2. GitHub Actions (or equivalent CI) triggers automatically.
3. CI runs: type checking (`tsc --noEmit`), linting (`npm run lint`), and tests (`npm run test`).
4. If any step fails, the PR is blocked from merging.
5. Tests run in isolation (no real Supabase or Gemini calls — mocked or using test doubles).
6. CI completes in < 3 minutes for fast feedback.

**Frontend**
- No UI; CI is a developer-facing workflow.

**Backend**
- `.github/workflows/ci.yml` with steps: checkout → Node 20 setup → `npm ci` → `npm run lint` → `tsc --noEmit` → `npm run test`.
- Test environment: uses `vitest` (already configured) with mocked Supabase and Gemini clients.
- Branch protection rule: require CI to pass before merge to `main`.
- Current test coverage: 9 test files, ~100 tests. Expand before enabling as a merge gate.

---

### OPS-02 — Staging environment
**Status:** ❌ Not started  
**Mandatory:** Yes

**User Story**  
As a developer, I want a staging environment separate from real data for safe testing.

**Use Cases**
1. Staging is a separate deployment (separate Supabase project, separate Gemini key).
2. Every merge to `main` auto-deploys to staging.
3. Developer tests features in staging before promoting to production.
4. Staging has its own `.env` with non-production credentials.
5. Staging may use `gemini-2.5-flash-lite` to reduce costs during testing.
6. Production deployment is manual (button click) or triggered by a release tag.

**Frontend**
- Staging URL: `staging.{domain}` or a platform preview URL (Vercel/Railway preview deployments).
- A visible banner in staging: "Staging environment — not for real data."

**Backend**
- Two Supabase projects: `ricotdin-staging` and `ricotdin-prod`.
- Two sets of environment variables in the deployment platform.
- Staging Supabase can be seeded with test data; prod never uses test data.
- DB schema migrations are applied to staging first; then promoted to prod.
- Recommended platforms: Vercel (Next.js-native) or Railway.

---

### OPS-03 — Periodic DB backup
**Status:** ❌ Not started  
**Mandatory:** Yes

**User Story**  
As an operator, I want periodic DB backups to recover from incidents.

**Use Cases**
1. Database is backed up automatically every day.
2. Backups are retained for at least 7 days.
3. In the event of data loss, an operator can restore the DB to a point-in-time within the retention window.
4. Backup process is verified periodically (a backup that can't be restored is not a backup).

**Frontend**
- No user-facing UI.
- Optional: backup status visible in the admin dashboard.

**Backend**
- **Supabase paid tier** includes automatic daily backups with 7-day retention. This is the recommended path.
- **Free tier:** no automated backups — workaround is a scheduled `pg_dump` script (e.g., a GitHub Actions cron or a small cron job on the host).
- Backup script: `pg_dump $DATABASE_URL | gzip > backup-$(date +%Y%m%d).sql.gz` → upload to S3/R2/GCS.
- Restore test: monthly restore to a scratch Supabase project to verify backup integrity.
- Audio files in Supabase Storage: Storage is NOT backed up by Supabase free tier — consider R2/S3 with versioning for production.

---

## Implementation Order

1. **OPS-01** (CI) — lowest effort, highest confidence gain. Set up GitHub Actions in one session.
2. **OPS-03** (backup) — if on Supabase paid tier, this is a single dashboard toggle. If free tier, write the backup script.
3. **OPS-02** (staging) — requires provisioning a second Supabase project + deployment platform configuration.

## Dependencies

- **OPS-01 depends on:** existing test suite (`npm run test` already configured)
- **OPS-02 depends on:** OPS-01 (CI must pass before staging auto-deploy)
- **OPS-03 depends on:** nothing; can be set up anytime

## Current CI Coverage (for context)

| Test File | Coverage Area |
|---|---|
| `admin-guards.test.ts` | Admin guard functions (21 tests) |
| `admin-pipeline.test.ts` | Pipeline admin endpoints (11 tests) |
| `auth-validate.test.ts` | Auth validation (24 tests) |
| `chunk.test.ts` | Transcript chunking |
| `ics.test.ts` | ICS calendar builder (30 tests) |
| `pipeline-parse.test.ts` | Gemini JSON parsing |
| `processMeeting-guard.test.ts` | Processing guards |
| `rag.test.ts` | RAG pipeline (12 tests) |
| `transcode.test.ts` | Audio transcoding |
