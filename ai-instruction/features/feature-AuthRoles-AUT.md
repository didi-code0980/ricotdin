# Auth & Roles Module (AUT)

**Module prefix:** AUT  
**Status:** ✅ Done (Phase 7)  
**Key files:** `app/api/auth/login/route.ts`, `app/api/auth/register/route.ts`, `lib/auth/server.ts`, `lib/auth/validate.ts`, `migrations/001_profiles.sql`, `migrations/002_jwt_hook.sql`, `migrations/003_rls_owner_or_admin.sql`, `scripts/seed-admin.ts`

---

## Overview

The Auth & Roles module implements secure email+password authentication with username-or-email login flexibility. Two roles (`user`, `admin`) are enforced at multiple layers: JWT claim injection, Row-Level Security, column-level privilege, and a database trigger. Anonymous sign-ins are disabled; the auth flow is fully server-mediated.

---

## Features

### AUT-01 — Sign up
**Status:** ✅ Done

**User Story**  
As a new user, I want to register with email + password + username to create an account.

**Use Cases**
1. User navigates to `/register`.
2. Fills in: email, username, password (min 8 chars, validated client + server).
3. Submits → `POST /api/auth/register`.
4. Server calls `auth.admin.createUser({ email, password, app_metadata: { role: 'user' } })`.
5. A `profiles` row is immediately inserted: `{ id, username, role: 'user' }`.
6. If profile insert fails, the auth user is cleaned up (no orphan auth rows).
7. On success, user is redirected to `/login`.

**Frontend**
- `/register` page with email, username, password fields.
- Client-side validation: email format, username alphanumeric (3–30 chars), password length.
- Inline error messages per field.
- On success, shows a success message + redirect to login.

**Backend**
- `POST /api/auth/register` — uses service role client (`auth.admin.createUser`).
- Role is ALWAYS `'user'` — never read from the request body.
- Username normalized: lowercase, trimmed before insert.
- Duplicate email/username returns a 409 with a user-friendly message.
- `lib/auth/validate.ts` — pure validation functions (24 unit tests).

---

### AUT-02 — Log in
**Status:** ✅ Done

**User Story**  
As a user, I want to log in with email or username for flexible access.

**Use Cases**
1. User navigates to `/login`.
2. Enters email OR username + password.
3. Submits → `POST /api/auth/login`.
4. Server detects if `identifier` contains `@` → treat as email. Otherwise → username lookup.
5. Username lookup: service-role query `profiles WHERE username = normalize(identifier)` → get `id` → `auth.admin.getUserById(id)` → resolve email.
6. `auth.signInWithPassword(resolvedEmail, password)` — returns session tokens.
7. Tokens are set as HTTP-only cookies; user is redirected to `/meetings`.

**Frontend**
- `/login` page with a single "Email or username" field + password field.
- Generic error on failure: "Invalid credentials" (never reveals whether email or username exists).
- On success: redirect to `/meetings` (or the originally requested URL via `next` query param).

**Backend**
- `POST /api/auth/login` — server-side only.
- Username-to-email mapping is NEVER exposed to the client.
- Generic error responses on any failure (prevents username/email enumeration).
- Session cookie: HTTP-only, Secure, SameSite=Lax.

---

### AUT-03 — Role authorization
**Status:** ✅ Done

**User Story**  
As the system, I want to store roles where users can't edit them and enforce at backend + RLS to prevent privilege escalation.

**Use Cases**
1. Role is stored ONLY in `auth.users.app_metadata.role` (writable only via service role).
2. `custom_access_token_hook` (migration 002) copies `app_metadata.role` → `user_role` JWT claim on every token issue.
3. RLS policies read `auth.jwt()->>'user_role'` — no per-query subquery, no user_metadata.
4. Column-level privilege: `REVOKE UPDATE ON profiles FROM authenticated; GRANT UPDATE(username) ON profiles TO authenticated;` — normal users literally cannot UPDATE the `role` column.
5. `prevent_role_escalation` trigger blocks any attempt to change `profiles.role` from the client session.
6. Admin role is seeded via `scripts/seed-admin.ts` (server-side only).

**Frontend**
- UI elements gated by role (e.g., `/admin` link only shown to admins).
- Role is read from the decoded JWT on the client; never from user_metadata.

**Backend**
- `lib/auth/server.ts` — `requireAdmin()` middleware checks `app_metadata.role === 'admin'`.
- All admin API routes call `requireAdmin()` before processing.
- Role changes must update BOTH `app_metadata` (via Admin API) AND `profiles.role`.

---

### AUT-04 — Data isolation
**Status:** ✅ Done

**User Story**  
As a user, I want to access only my own data to ensure privacy.

**Use Cases**
1. All tables (`meetings`, `todos`, `calendar_suggestions`, `transcript_segments`, `transcript_chunks`, `chat_sessions`, `chat_messages`) have RLS enabled.
2. Standard policy: `auth.uid() = user_id OR auth.jwt()->>'user_role' = 'admin'` (owner-or-admin).
3. Browser uses the anon key — all queries are RLS-scoped to the logged-in user.
4. Server pipeline uses the service role key — bypasses RLS for background writes.
5. Admin users can read all rows; normal users can only read their own.

**Frontend**
- Transparent to the user; the server never returns another user's data.
- The anon key is safe to expose in the browser (RLS enforces isolation).

**Backend**
- RLS applied via migration 003 (`003_rls_owner_or_admin.sql`).
- Server pipeline uses `SUPABASE_SERVICE_ROLE_KEY` (env var, never exposed to the browser).
- Admin API routes use service role client but are protected by `requireAdmin()` application-level guard.

---

## Auth Architecture Summary

```
Browser (anon key)
  ↓ POST /api/auth/login
Server (service role)
  → username lookup (if username login)
  → signInWithPassword
  → HTTP-only session cookie
  ↓ All subsequent requests
Browser sends session cookie
  → Supabase validates JWT
  → custom_access_token_hook injects user_role claim
  → RLS uses auth.jwt()->>'user_role'
```

## Role Enforcement Layers (defence-in-depth)

| Layer | Mechanism |
|---|---|
| JWT source | `app_metadata.role` (service-role-only write) |
| JWT claim | `custom_access_token_hook` → `user_role` |
| Database | RLS policies on all tables |
| Column | `REVOKE UPDATE ON profiles` |
| Trigger | `prevent_role_escalation` |
| Application | `requireAdmin()` in all admin routes |

## Dependencies

- **Depends on:** Supabase Auth + custom access token hook (dashboard config required)
- **Blocks:** all other modules (auth is the foundation for data access)
