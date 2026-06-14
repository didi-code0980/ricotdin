# Security Module (SEC)

**Module prefix:** SEC  
**Status:** ❌ Not started — all four are mandatory for production  
**Priority:** Mandatory for any path including internal use

---

## Overview

The Security module addresses the baseline hardening required before the app handles real user accounts and data. Rate limiting prevents brute-force attacks, email verification blocks fake accounts, RLS review audits data isolation, and secret management prevents key leaks.

---

## Features

### SEC-01 — Login rate-limiting
**Status:** ❌ Not started  
**Mandatory:** Yes

**User Story**  
As the system, I want to rate-limit login attempts to prevent brute-force attacks.

**Use Cases**
1. An attacker makes 1000 login requests per minute against `POST /api/auth/login`.
2. After N failed attempts from the same IP (or username), the endpoint returns 429 Too Many Requests.
3. The response includes a `Retry-After` header indicating when the client may retry.
4. Legitimate users experience no throttling during normal use.
5. Rate limit is applied per IP and optionally per username (to block targeted attacks).

**Frontend**
- On 429 response, the login form shows: "Too many attempts. Please try again in X minutes."
- Submit button is disabled during the cooldown.

**Backend**
- Implementation options:
  - **Upstash Redis + `@upstash/ratelimit`** — serverless-compatible, recommended.
  - **In-memory (LRU)** — works for single-instance deployments; resets on restart.
  - **Supabase Auth built-in** — Supabase has some built-in rate limiting; verify if sufficient.
- Limit: e.g., 5 failed attempts per IP per 15 minutes.
- Applies to `POST /api/auth/login` only (registration has lower abuse surface).
- Applies to password reset endpoint too.

---

### SEC-02 — Email verification
**Status:** ❌ Not started  
**Mandatory:** Yes

**User Story**  
As the system, I want email verification at sign-up to ensure real accounts.

**Use Cases**
1. User registers with an email address.
2. A verification email is sent to the address.
3. User must click the verification link before they can access the app.
4. Unverified users who try to log in see: "Please verify your email first. Check your inbox."
5. Resend verification email link available on the login page.

**Frontend**
- After registration: "Check your email for a verification link."
- Login page: shows "Email not verified" error with a "Resend verification email" link.
- Verification success page: "Email verified! You can now log in."

**Backend**
- Supabase Auth has built-in email verification — enable in dashboard: Authentication → Email → "Confirm email" → enabled.
- `POST /api/auth/register` uses `auth.admin.createUser({ email_confirm: false })` by default; Supabase sends the verification email automatically.
- `POST /api/auth/resend-verification` — `auth.admin.generateLink({ type: 'signup' })` to resend.
- Requires SMTP configured in Supabase project settings.
- Depends on: AUT-01 (registration flow).

---

### SEC-03 — RLS review
**Status:** ❌ Not started  
**Mandatory:** Yes

**User Story**  
As an operator, I want a full RLS review to be sure data isolation holds.

**Use Cases**
1. A security-minded developer audits all RLS policies across: `meetings`, `transcript_segments`, `transcript_chunks`, `todos`, `calendar_suggestions`, `chat_sessions`, `chat_messages`, `profiles`, `audit_logs`.
2. For each table, verify:
   - SELECT policy: users can only read their own rows (or all rows if admin).
   - INSERT policy: users can only insert rows with their own `user_id`.
   - UPDATE policy: users can only update their own rows.
   - DELETE policy: users can only delete their own rows.
3. All policies use `auth.jwt()->>'user_role'` (not `user_metadata`) for admin check.
4. Service role key bypasses RLS (intentional for pipeline) — verify it's never exposed to the browser.
5. Penetration test: log in as User A, attempt to query User B's meeting ID directly — should return 0 rows.

**Frontend**
- No UI change.

**Backend**
- Review `migrations/003_rls_owner_or_admin.sql` against the full table list.
- Check that `transcript_chunks` (added for RAG) has RLS applied.
- Check that `audit_logs` has admin-only SELECT.
- Check that `profiles` allows users to read all profiles (for username display) but only update their own username column.
- Document findings in `ai-instruction/security-audit.md`.

---

### SEC-04 — Secret management
**Status:** ❌ Not started  
**Mandatory:** Yes

**User Story**  
As the system, I want proper secret management (no hard-coding) to avoid key leaks.

**Use Cases**
1. No secret values appear in committed code (`.env.local` is in `.gitignore`).
2. All secrets are injected via environment variables at runtime.
3. `NEXT_PUBLIC_*` variables only contain non-sensitive values (Supabase anon key + URL are public by design).
4. `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` are never logged, never sent to the client, never included in error messages.
5. Secrets are rotated if a leak is suspected; the app continues to work after rotation by updating env vars.

**Frontend**
- No `NEXT_PUBLIC_*` variable contains a secret.
- Client-side code must not include service role key or Gemini key (TypeScript import guards help).

**Backend**
- `.env.local` in `.gitignore` — verify.
- `scripts/check.ts` (`npm run check`) verifies env vars are set.
- Consider adding a lint rule or CI check that fails if `SUPABASE_SERVICE_ROLE_KEY` or `GEMINI_API_KEY` appears in any `NEXT_PUBLIC_*` variable or in client-side code.
- Production secret storage: Vercel env vars, Railway env vars, or a secrets manager (Vault, 1Password Secrets Automation).

---

## Implementation Order

1. **SEC-04** (secret management audit) — verify `.gitignore`, scan for leaked secrets in git history with `git-secrets` or `trufflehog`. Low effort, high value.
2. **SEC-01** (rate limiting) — add to login route before launch.
3. **SEC-02** (email verification) — enable in Supabase dashboard + update register flow.
4. **SEC-03** (RLS review) — schedule a dedicated review session; document findings.

## Dependencies

- **SEC-01 depends on:** AUT-02 (login endpoint)
- **SEC-02 depends on:** AUT-01 (registration)
- **SEC-03 depends on:** AUT-03, AUT-04 (RLS is already applied; this is an audit)
- **SEC-04 depends on:** nothing; should be done first
