# Admin Module (ADM)

**Module prefix:** ADM  
**Status:** Partially done — ADM-01 through ADM-04 ✅ Done (Phases 9, 10a). ADM-05 through ADM-11 ❌ Not started.  
**Key files:** `app/(routes)/admin/`, `app/(routes)/admin/pipeline/`, `app/api/admin/users/`, `app/api/admin/pipeline/`, `lib/admin/guards.ts`, `lib/admin/audit.ts`, `migrations/005_audit_logs.sql`

---

## Overview

The Admin module provides system operators with tools to manage users, monitor the processing pipeline, and (planned) track costs, storage, configuration, and audit logs. All admin routes are server-enforced with `requireAdmin()` — a non-admin request receives 403.

---

## Features

### ADM-01 — User list
**Status:** ✅ Done

**User Story**  
As an admin, I want to view/search/paginate the user list to administer the system.

**Use Cases**
1. Admin navigates to `/admin`.
2. Page loads the user list via `GET /api/admin/users`.
3. List shows: email, username, role badge, disabled status, meeting count, last sign-in date, created date.
4. Admin searches by email or username (client-side filter on the fetched list).
5. Admin paginates (20 rows per page, client-side).
6. Admin's own row shows a "You" badge; self-action buttons are disabled.

**Frontend**
- `/admin` page with a data table.
- Search input filters rows client-side.
- Pagination controls at the bottom.
- "You" badge on the current admin's row.
- Per-row action buttons: Change Role, Enable/Disable, Reset Password, Delete.

**Backend**
- `GET /api/admin/users?page&perPage&search` — fetches up to 1000 users via `auth.admin.listUsers()`.
- Joins `profiles` for username + meeting counts.
- Search + pagination applied server-side (filtered in JS before responding).
- `requireAdmin()` check before any processing.

---

### ADM-02 — Account management
**Status:** ✅ Done

**User Story**  
As an admin, I want to change roles, disable/enable, reset password, and delete users to manage account lifecycle.

**Use Cases**

**Change role:**
1. Admin clicks role badge → dropdown: User / Admin.
2. `PATCH /api/admin/users/:id/role { role }` → updates `auth.users.app_metadata.role` AND `profiles.role`.
3. Optimistic UI update; reverts on error.
4. Target user's role takes effect on their next token refresh.

**Disable/Enable:**
1. Admin clicks Disable/Enable toggle.
2. `PATCH /api/admin/users/:id/status { disabled: boolean }`.
3. Disable: sets `ban_duration = '876600h'` (100 years) via Admin API.
4. Enable: sets `ban_duration = 'none'`.

**Reset password:**
1. Admin clicks Reset Password → confirmation dialog.
2. `POST /api/admin/users/:id/reset-password` → `auth.admin.generateLink({ type: 'recovery' })`.
3. Recovery email sent to the user's email (requires SMTP configured in Supabase).

**Delete user:**
1. Admin clicks Delete → confirmation dialog.
2. `DELETE /api/admin/users/:id` → gathers all `audio_path` from user's meetings → deletes Storage objects → `auth.admin.deleteUser(id)` → all DB rows cascade.

**Frontend**
- Role badge: clickable dropdown with User/Admin options.
- Enable/Disable: toggle switch or button.
- Reset Password + Delete: confirmation dialogs with clear warning text.
- All mutations are optimistic with revert on error.

**Backend**
- All routes guarded by `requireAdmin()`.
- Role sync: every role change updates BOTH `app_metadata` and `profiles.role`.
- Storage cleanup before user delete: best-effort (failures logged as `storageWarnings[]`).

---

### ADM-03 — Safety constraints
**Status:** ✅ Done

**User Story**  
As an admin, I want to be blocked from demoting/locking/deleting myself and deleting the last admin so I can't lock the system out.

**Use Cases**
1. Admin tries to demote, disable, or delete themselves → 400 error: "Cannot perform this action on your own account."
2. Admin tries to demote or disable the last admin → 400 error: "Cannot remove the last admin."
3. Self-action buttons are disabled in the UI (the server still enforces it as defence-in-depth).
4. Admin count is read from `profiles WHERE role = 'admin'` before any demotion/disable/delete.

**Frontend**
- Self-row: role dropdown, disable toggle, delete button are all disabled (grayed out) with tooltip.
- Error banners shown for any constraint violation.

**Backend**
- `lib/admin/guards.ts` — pure functions:
  - `checkAdminRole(appMetadata)` — returns false → HTTP 403 for non-admins.
  - `isSelf(actorId, targetId)` — blocks self-actions.
  - `isLastAdmin(adminCount)` — blocks last-admin removal.
- 21 unit tests in `tests/admin-guards.test.ts`.

---

### ADM-04 — Pipeline & job monitoring
**Status:** ✅ Done

**User Story**  
As an admin, I want a pipeline dashboard to operate without inspecting the DB by hand.

**Use Cases**
1. Admin navigates to `/admin/pipeline`.
2. Status tiles show counts: Pending, Processing, Stuck (processing > 15 min), Failed, Done + avg processing time.
3. Clicking a tile filters the jobs table to that status.
4. Jobs table shows: status badge, meeting title/id, owner email/username, created date (GMT+7), duration, error snippet.
5. Each failed/stuck row has a **Requeue** button.
6. "Requeue all stuck/failed" bulk button with confirmation dialog.
7. Page auto-polls every 10 seconds.

**Frontend**
- `/admin/pipeline` page.
- Status tiles (click to filter).
- Filter tabs + sortable jobs table.
- Requeue button per failed/stuck row (disabled for pending/done).
- Bulk requeue button with confirmation.
- 10-second interval auto-poll.
- Sub-navigation: Users | Pipeline.

**Backend**
- `GET /api/admin/pipeline/overview` — aggregate counts + avg processing secs. Computed in JS from service-role query (no RLS). Stuck = `processing AND updated_at < now() - 15 min`.
- `GET /api/admin/pipeline/jobs?status=&page=&perPage=` — metadata-only list (NO transcript/notes content). Includes owner email/username via join with `profiles` + `auth.users`.
- `POST /api/admin/pipeline/:id/requeue` — safe re-run:
  1. Verify status is `failed` or `processing`.
  2. Delete `transcript_segments`, `todos`, `calendar_suggestions` (transcript_chunks cascade).
  3. Reset `meetings.status='pending'` + clear `error_message/summary/notes/language`.
  4. Write audit log entry: `meeting.requeue`.
  5. Fire `processMeeting()` non-awaited.
  - Returns 422 for `pending`/`done` meetings.
- Audit log: `lib/admin/audit.ts` → `writeAuditLog()` (fire-and-forget).
- Migration 005 required for `audit_logs` table.

---

### ADM-05 — Cost & AI quota monitoring
**Status:** ❌ Not started

**User Story**  
As an admin, I want to track daily Gemini calls, 429/503 error rate, token consumption, and storage usage vs. limits (with near-limit alerts) to know when to enable billing or clean up audio.

**Use Cases**
1. Admin views a dashboard showing: Gemini API calls today, 429 error rate, estimated token usage, Supabase Storage used vs. 1GB cap.
2. Near-limit alerts appear when storage > 80% or API error rate > threshold.
3. Admin can drill into per-meeting token usage.

**Frontend**
- Metrics tiles at `/admin/usage` (or a tab on `/admin/pipeline`).
- Trend charts (daily call count, error rate).
- Alert banners for near-limit conditions.

**Backend**
- Requires instrumenting the Gemini service layer to log call metadata.
- Storage usage: Supabase Storage management API.
- Depends on: CST-01 (cost model), PRP-03 (Gemini calls logged).

---

### ADM-06 — Storage management
**Status:** ❌ Not started

**User Story**  
As an admin, I want to see total audio usage, orphaned files, and bulk cleanup tools to avoid hitting the 1GB cap.

**Use Cases**
1. Admin views total audio usage in MB/GB.
2. Admin sees a list of orphaned files (in Storage but no corresponding `meetings` row).
3. Admin can bulk-delete audio files older than N days.
4. Cleanup confirms how many bytes were freed.

**Frontend**
- Storage management tab at `/admin`.
- File list with size, meeting reference, and age.
- Bulk cleanup with policy selection.

**Backend**
- Cross-reference Supabase Storage object list with `meetings.audio_path` values.
- Bulk delete API with dry-run mode.
- Depends on: PRP-01, MMG-04.

---

### ADM-07 — Audit log
**Status:** ⚠️ Partial (table + write helper done; viewer UI not started)

**User Story**  
As an admin, I want sensitive actions logged to trace incidents and prevent abuse.

**Use Cases**
1. Sensitive actions (role change, user delete, meeting requeue, admin login) are automatically written to `audit_logs`.
2. Admin views a paginated audit log at `/admin/audit`.
3. Admin can filter by actor, action type, date range.
4. Log entries show: actor email, action, target type/id, metadata (before/after), IP, user agent, timestamp.

**What's done:**
- `migrations/005_audit_logs.sql` — `audit_logs` table with 4 indexes. RLS: admin SELECT only; writes via service role.
- `lib/admin/audit.ts` — `writeAuditLog()` fire-and-forget helper + `requestContext()` IP/UA extractor.
- `meeting.requeue` action is logged (ADM-04).

**What's missing:**
- Audit log viewer UI at `/admin/audit`.
- Log entries for role changes, user deletes, user creates, admin logins.

**Backend (existing)**
- `audit_logs` table: `id, actor_id, actor_email, action, target_type, target_id, metadata jsonb, ip_address, user_agent, created_at`.
- `GET /api/admin/audit?page&perPage&actor&action&from&to` — to be built.

---

### ADM-08 — System health
**Status:** ❌ Not started

**User Story**  
As an admin, I want a system-status page showing error rate, uptime, and Supabase/Gemini health.

**Use Cases**
1. Admin views `/admin/health` with: app error rate, Supabase connectivity, Gemini API status, uptime percentage.
2. Automated alerts when any component is unhealthy.

**Depends on:** OBS-01 (Sentry), OBS-03 (uptime monitoring).

---

### ADM-09 — Extended user management
**Status:** ❌ Not started

**User Story**  
As an admin, I want to invite users by email, view per-user usage, do bulk actions, and filter by status/role.

**Depends on:** ADM-01, ADM-02.

---

### ADM-10 — Config & feature flags
**Status:** ❌ Not started

**User Story**  
As an admin, I want to change runtime config (model, audio retention, sign-up toggle) without a deploy.

**Depends on:** PRP-07.

---

### ADM-11 — Data control & privacy
**Status:** ❌ Not started

**User Story**  
As an admin, I want to enforce retention/deletion and export/erase all of a user's data on request.

**SaaS tier only. Depends on:** PRV-02, MMG-04.

---

## Dependencies

- **Depends on:** AUT-03 (role enforcement), PRP-07 (pipeline status)
- **Blocks:** nothing downstream (admin module is a management layer)
