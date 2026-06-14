# CLAUDE.md

Project memory for Claude Code. Read this fully at the start of every session.
Keep it updated as the project evolves — this file is the source of truth.

## 1. What we are building

A **meeting assistant** web app (MVP). The user records a meeting in the
browser, the app produces a transcript + summary + meeting note, extracts
to-do items and calendar mentions, and offers a RAG chatbot to ask questions
about past meetings (NotebookLM-style).

**MVP scope (build this):**
1. In-browser recording (screen/tab + system audio + mic).
2. Upload audio → process → transcript with timestamps.
3. Meeting note + summary.
4. To-do extraction.
5. RAG chatbot over transcripts (with timestamp citations).
6. Surface calendar suggestions + to-dos in the UI (display only).

**Explicitly OUT of MVP scope (do NOT build yet):**
- Google Calendar OAuth / auto-creating events (MVP only offers `.ics` download).
- Proactive reminders / push notifications.
- Auto-detecting which meeting app is running / auto-starting recording.
- Multi-user collaboration features.
Do not add these without being asked, even if they seem natural.

## 2. Tech stack

- **Next.js (App Router) + TypeScript** — single codebase, frontend + API in one.
  Runs as a long-lived `next start` server on the user's own host (NOT serverless),
  so route handlers may run long tasks directly; no external queue needed for MVP.
- **Supabase** — Postgres (with pgvector), Storage (audio), Auth.
- **Google Gemini** via Google AI Studio API — Flash / Flash-Lite, free tier for MVP.
- Package manager: npm. Node 20+.

## 3. Architecture & data flow

```
Browser (recorder + UI)
  → upload audio to Supabase Storage via presigned URL (direct, not through server)
  → notify server route; create `meetings` row (status=pending)
  → server pipeline: download audio → Gemini Files API → Gemini Flash
      → returns JSON: transcript segments + summary + notes + todos + calendar mentions
  → write rows to Postgres; chunk transcript; embed chunks → transcript_chunks
  → status=done
UI reads results. Chat: embed question → match_transcript_chunks RPC → Gemini answer + citations.
```

## 4. Directory structure (target)

```
/app                      Next.js App Router (pages + route handlers)
  /api                    route handlers (server-only)
  /(routes)               UI pages (meeting list, meeting detail, chat)
/lib
  /gemini                 Gemini service layer (the ONLY place that calls Gemini)
  /supabase               typed Supabase client helpers (browser + server/service)
  /audio                  client-side recording + chunking helpers
/components               React components
/types                    shared TypeScript types (incl. DB row types)
schema.sql                database schema (apply as a migration)
CLAUDE.md                 this file
```

## 5. Conventions

- TypeScript strict mode. No `any` unless justified with a comment.
- Server-only code (anything touching the Gemini key or Supabase service role key)
  lives in `/app/api` route handlers or `/lib` modules imported only by the server.
  **The Gemini API key and the Supabase service role key must NEVER reach the browser.**
- Use the typed Supabase client; mirror DB types in `/types`.
- Errors: throw typed errors in `/lib`, catch + map to HTTP responses in routes.
  User-facing errors are friendly; full detail goes to logs and `meetings.error_message`.
- Naming: `camelCase` in TS, `snake_case` in SQL (matches the schema).
- Keep functions small and single-purpose. Prefer pure functions in `/lib`.

## 6. Database

Schema is in `schema.sql` (Postgres + pgvector). Key tables:
`meetings` (root), `transcript_segments` (canonical transcript), `transcript_chunks`
(embeddings for RAG), `todos`, `calendar_suggestions`, `chat_sessions`,
`chat_messages`. RAG retrieval is the `match_transcript_chunks` RPC.

**`meetings` additional columns (via migrations):**
- `pinned_at timestamptz NULL` (migration 004) — null = not pinned. Set to `now()` to pin.
  List sort: `pinned_at DESC NULLS LAST, created_at DESC` (pinned first, most-recently-pinned on top).
  Index: `meetings_user_pin_sort ON meetings (user_id, pinned_at DESC NULLS LAST, created_at DESC)`.

**Delete rule:** when deleting a meeting, the server route (`DELETE /api/meetings/:id`)
MUST attempt to remove `meetings.audio_path` from Supabase Storage (bucket `recordings`)
using the service-role client BEFORE deleting the row. Storage delete failure is logged
and surfaced as a `warning` field in the response, but the row delete always proceeds
(no half-state). All child rows are removed by `ON DELETE CASCADE` on the DB side
(transcript_segments, transcript_chunks, todos, calendar_suggestions, chat_sessions,
chat_messages).

Rules:
- RLS is ON. The browser uses the anon key (RLS-scoped to the logged-in user).
- The **server pipeline uses the service role key** (bypasses RLS) for background writes.
- Embedding dimension is **768** and must match the `output_dimensionality` we
  request from Gemini's embedding model. Do not change one without the other.

## 7. Gemini integration rules

- All Gemini calls go through `/lib/gemini` — a single service layer. Nothing else
  imports the Gemini SDK directly. This lets us switch free↔paid with zero changes
  elsewhere.
- Use **JSON mode** with a fixed response schema for the pipeline output, and parse
  defensively (strip code fences, validate before using).
- **Retry with exponential backoff on HTTP 429** (free tier hits rate limits often).
- **Chunk long audio** into ~20–30 minute segments before sending, to stay under
  the per-minute token limit; stitch transcripts back together by time offset.
- Default model: `gemini-2.5-flash` for the pipeline (quality), `gemini-2.5-flash-lite`
  is acceptable for cheap/iterative dev runs. Make the model name a config constant.
- Upload audio via the Gemini **Files API** (temporary staging, ~48h retention) and
  reference it in the prompt; do not inline large audio as base64.
- **Free-tier privacy note:** on the free tier, inputs may be used by Google for
  training. For dev/testing use synthetic or non-sensitive recordings only.

## 8. Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server only, NEVER exposed to client
GEMINI_API_KEY=                   # server only, NEVER exposed to client
```
Anything not prefixed `NEXT_PUBLIC_` is server-only. Never log secret values.

## 9. Commands

```
npm run dev        # local development
npm run build      # production build
npm run start      # run the production server (deployment target)
npm run lint       # ESLint
npm run check      # connectivity check: Gemini + Supabase (reads .env.local)
npm run test       # run tests (not yet configured)
```

## 9a. Manual Supabase dashboard actions required

Before Phase 2 features work end-to-end, you must do the following once in the
Supabase dashboard:

1. **Create a private Storage bucket named `recordings`**
   - Dashboard → Storage → New bucket → Name: `recordings` → uncheck "Public bucket" → Save
   - The server route checks for this bucket on every upload and returns 503 with a
     clear message if it is missing.

2. ~~**Enable Anonymous sign-ins**~~ **Phase 7 complete — disable this now.**
   - Dashboard → Authentication → Providers → Anonymous sign-ins → **Disable**
   - Real email+password auth is in place. Existing anonymous-user test data is
     orphaned — wipe it with `DELETE FROM auth.users WHERE is_anonymous = true`.

3. **Apply Phase 7 migrations** (run in the SQL editor in order):
   - `migrations/001_profiles.sql` — profiles table + RLS + role-escalation trigger
   - `migrations/002_jwt_hook.sql` — custom access token hook function
   - `migrations/003_rls_owner_or_admin.sql` — owner-or-admin RLS on all tables
   - Then: Dashboard → Authentication → Hooks → Custom Access Token →
     select `public.custom_access_token_hook` and save.

4. **Apply Phase 8 migration:**
   - `migrations/004_meetings_pinned.sql` — adds `pinned_at` column + sort index to `meetings`.

## 9b. Auth/roles — Phase 7 design

**Role storage (NEVER in user_metadata):**
- Role is stored in `auth.users.app_metadata.role` (service-role-writable only).
- Also mirrored in `public.profiles.role` (display/join; kept in sync by server routes).
- `user_metadata` is user-writable via the SDK → NEVER store role there.

**JWT claim injection:**
- `migrations/002_jwt_hook.sql` registers `public.custom_access_token_hook`.
- The hook copies `app_metadata.role` → `user_role` JWT claim on every token issue.
- RLS policies read `auth.jwt()->>'user_role'` (no per-query subquery).
- Dashboard step: Authentication → Hooks → Custom Access Token → enable the function.

**Username → email login flow (server-side only):**
- `POST /api/auth/login` accepts `{ identifier, password }`.
- If `identifier` contains `@` → treat as email.
- Otherwise → service-role lookup: `profiles WHERE username = normalize(identifier)`,
  then `auth.admin.getUserById(profile.id)` to get the email.
- `signInWithPassword(resolvedEmail, password)` is called on the server.
- The mapping is NEVER exposed to the client; generic errors are returned on failure.

**Registration:**
- `POST /api/auth/register` creates the user via `auth.admin.createUser` with
  `app_metadata: { role: 'user' }`. Client cannot choose a role.
- Profile row is inserted immediately after; on failure the auth user is cleaned up.

**RLS: OWNER-OR-ADMIN:**
- All tables use `auth.uid() = owner_id OR auth.jwt()->>'user_role' = 'admin'`.
- Server pipeline still uses the service role key (bypasses RLS entirely).

**Admin seed script:**
```
npx tsx scripts/seed-admin.ts <email>
```
Reads `.env.local`, sets `app_metadata.role='admin'` and syncs `profiles.role`.
Run once for the first admin account; use `/admin` UI for subsequent changes.

**Column-level privilege:**
`REVOKE UPDATE ON profiles FROM authenticated; GRANT UPDATE(username) ON profiles TO authenticated;`
Normal users literally cannot UPDATE the `role` column from the browser.
The `prevent_role_escalation` trigger is a belt-and-suspenders backup.

## 9c. Admin user-management design (Phase 9)

All operations use the **Supabase Auth Admin API** (`auth.admin.*`) with the **service
role key** (server-side only). `auth.users` is not queryable from the browser.

**Endpoints:**
- `GET /api/admin/users?page&perPage&search` — paginated list with email, username, role,
  disabled status, meeting_count, last_sign_in_at, created_at. Up to 1000 users fetched
  from Admin API; search + pagination applied server-side.
- `PATCH /api/admin/users/:id/role` — change role to `'user'` or `'admin'`.
- `PATCH /api/admin/users/:id/status` — `{ disabled: boolean }` → enable/disable via
  `ban_duration = '876600h'` (disable) or `'none'` (enable).
- `POST /api/admin/users/:id/reset-password` — `auth.admin.generateLink({ type: 'recovery' })`
  triggers a recovery email. Requires SMTP configured in Supabase project settings.
  Does NOT set a password directly.
- `DELETE /api/admin/users/:id` — collects `audio_path` from all user meetings, deletes
  Storage objects (service role), then `auth.admin.deleteUser()`. DB rows cascade.

**Role sync rule:** every role change must update BOTH:
1. `auth.users.app_metadata.role` (Admin API → JWT source of truth)
2. `public.profiles.role` (display table)
Do not update one without the other. If the auth update succeeds but profiles sync fails,
log a warning (app_metadata is authoritative; profiles will be corrected on next change).

**Role change timing:** the new role takes effect on the target user's **next token
refresh**. There is an inherent delay; advise the user to sign out and back in to see
their new role reflected immediately.

**Guards** (pure functions in `lib/admin/guards.ts`, tested in `tests/admin-guards.test.ts`):
- `checkAdminRole(appMetadata)` — used by `requireAdmin`; returns `false` → HTTP 403.
- Self-action: admins cannot demote, disable, or delete **themselves**.
- Last-admin: cannot demote, disable, or delete the **last remaining admin**.
  Admin count is read from `profiles WHERE role = 'admin'` (kept in sync).

**Storage cleanup on user delete:**
Before `auth.admin.deleteUser`, gather all `meetings.audio_path` for the target user
and call `storage.from('recordings').remove(paths)`. Storage failures are logged and
returned as `storageWarnings[]` but never abort the user delete. DB rows cascade via
the `auth.users → profiles` and `auth.users → meetings` FK `ON DELETE CASCADE`.

**UI at `/admin`:**
- Shows current admin's row with a "You" badge; self-action buttons are disabled.
- Client-side search by email/username; pagination at 20 per page.
- Role change and status toggle are optimistic with revert on error.
- Delete and password-reset open confirmation dialogs before running.
- Global success/error banners with dismiss.

## 9d. Admin pipeline monitor design (Phase 10a)

**Endpoints (all server-enforced by `requireAdmin`):**
- `GET /api/admin/pipeline/overview` — aggregate counts (pending/processing/done/failed/stuck) + avg_processing_secs for done meetings. Fetches all `meetings.status + created_at + updated_at` and computes in JS (service role, no RLS).
- `GET /api/admin/pipeline/jobs?status=&page=&perPage=` — metadata-only paginated list: id, title, status, created_at, updated_at, duration_seconds, error_message, owner_email, owner_username. `status=stuck` = processing older than 15 min. Never exposes summary/notes/transcript content.
- `POST /api/admin/pipeline/:id/requeue` — safe re-run for failed/stuck meetings. Steps: (1) verify status is failed or processing, (2) delete transcript_segments + todos + calendar_suggestions (transcript_chunks cascade), (3) reset meetings.status='pending' + clear error_message/summary/notes/language, (4) write `meeting.requeue` audit log, (5) fire `processMeeting()` non-awaited. Returns 422 for pending/done meetings.

**Stuck definition:** `status = 'processing' AND updated_at < now() - 15 minutes`.

**Audit log (migration 005):** `audit_logs` table with actor_id, actor_email, action, target_type, target_id, metadata jsonb, ip_address, user_agent. RLS: admin SELECT only; writes via service role. `lib/admin/audit.ts` exports `writeAuditLog()` (fire-and-forget, never throws) and `requestContext()`.

**UI at `/admin/pipeline`:**
- Status tiles (Pending/Processing/Stuck/Failed/Done + avg duration) — click a tile to filter the table.
- Filter tabs + job table: Status badge, Meeting title/id, Owner email/username, Created (GMT+7), Duration, Error snippet, Requeue button (enabled for failed/stuck only).
- "Requeue all stuck/failed" bulk button with confirmation dialog.
- 10-second auto-poll; re-fetches on filter/page changes.
- Sub-nav links: Users | Pipeline (extensible for Usage + Audit in later phases).

## 10. Working agreement (how to collaborate with me)

- Work in **small increments**, one clear goal per change, each with a concrete
  "done" check. Do not attempt the whole app in one go.
- After each working increment, **commit to git** with a clear message.
- **TDD is mandatory for all new logic:**
  - Write unit tests for every new pure function **before** writing the implementation.
  - Tests go in `tests/` with the `.test.ts` extension and must be added to the
    `npm test` script in `package.json`.
  - When **any existing logic changes**, update the corresponding tests first, then
    change the implementation.
  - Tests must be pure (no I/O, no mocks) — test pure functions extracted into `/lib`.
- **Update `ai-instruction/tracking.md`** when a feature is completed: change `[ ]`
  to `[x]` in the "Is Done?" column for every Feature Code that the work covers.
- Before making large or structural changes, briefly state the plan and wait.
- When you hit an error, surface the exact error/log rather than guessing silently.
- If a request seems to contradict this file (e.g. would expose a key to the client,
  or pull in an out-of-scope feature), flag it instead of just doing it.

## 11. Build order (current plan)

0. ~~Setup: scaffold Next.js+TS, apply `schema.sql`, verify Supabase + Gemini connectivity.~~ **DONE** (Phase 0 complete — `npm run dev` serves placeholder; `npm run check` verifies both credentials)
1. ~~**Recording** (highest technical risk — validate audio capture first).~~ **DONE** (Phase 1 complete — `/record` page; mic + display audio mixed via Web Audio API; `useRecorder` hook; unsupported-browser + no-system-audio warnings; Chrome/Edge only)
2. ~~**Upload + storage** (presigned URL, `meetings` row).~~ **DONE** (Phase 2 complete — anonymous auth bootstrap; server routes POST /api/meetings + POST /api/meetings/:id/uploaded; direct browser→Storage upload via signed URL; meeting list `/meetings`; placeholder detail `/meetings/[id]`. Requires dashboard: create `recordings` bucket + enable Anonymous sign-ins — see section 9a.)
3. ~~**Processing pipeline** (Gemini service layer, JSON output, chunking, retry, embeddings).~~ **DONE** (Phase 3 complete — transcribeAudio/analyzeTranscript/embedChunks in /lib/gemini; chunkSegments + processMeeting in /lib/pipeline; POST /api/meetings/:id/process trigger; auto-triggered from /uploaded; 3s polling on meetings list; ffmpeg-based long-audio chunking with clear error if ffmpeg absent; 21 unit tests; npm run test configured).
4. ~~**Results UI** (summary / note / transcript / todos).~~ **DONE** (Phase 4 complete — full meeting detail page at `/meetings/[id]`; state machine: loading → inflight (polls 3s) | failed (re-run button) | done; sections: header, audio player via signed URL, summary, markdown notes (react-markdown + rehype-sanitize), todos with optimistic checkbox toggle, calendar suggestions with dismiss, full transcript with speaker-grouped segments and mm:ss timestamps that seek the audio player; chat placeholder. New routes: GET /api/audio-url/:id, PATCH /api/todos/:id, PATCH /api/calendar-suggestions/:id.)
5. ~~**RAG chatbot** (RPC search + grounded answers with citations).~~ **DONE** (Phase 5 complete — full RAG pipeline: `lib/rag/retrieve.ts` embeds query + calls `match_transcript_chunks` RPC with user-scoped client (RLS enforces ownership); `lib/gemini/answer.ts` generates grounded JSON answer with citation validation (invented chunk_ids dropped); `POST /api/chat` route manages sessions + persists messages + streams through the full pipeline; `ChatPanel` component with optimistic UI, citation chips, session history; chat enabled in meeting detail (`/meetings/[id]`); cross-meeting `/chat` page; `Chat` button in meetings list. 12 new unit tests in `tests/rag.test.ts`. New files: `lib/supabase/user-client.ts`, `lib/rag/retrieve.ts`, `lib/gemini/answer.ts`, `app/api/chat/route.ts`, `components/ChatPanel.tsx`, `app/(routes)/chat/page.tsx`.)
6. ~~**Calendar suggestions + todos surfaced in UI** (`.ics` download).~~ **DONE** (Phase 6 complete — pure RFC 5545 ICS builder in `lib/ics/index.ts` (no deps; escaping, folding, UTC); `GET /api/calendar-suggestions/[id]/ics` with ownership check, 422 on null proposed_at (never fabricate a datetime); meeting detail UI: `.ics` download button (fetch+blob with Bearer token) when proposed_at is set, disabled span when null; todo dismiss button (PATCH status=dismissed, optimistic); metadata row always shown with "No due date" when null; past-due date styled orange/amber with ⚠ prefix; helper text on calendar section ("no automatic syncing"); 30 new unit tests in `tests/ics.test.ts`. No Google Calendar OAuth, no auto-creating events, no reminders — post-MVP only.)
7. ~~**Auth, hardening, deploy**~~ **DONE** (Phase 7 complete — email+password registration/login; username-OR-email login (server-side username→email lookup, never exposed to client); two roles: 'user' (default) and 'admin'; role stored ONLY in `app_metadata` + `profiles` table, NEVER in `user_metadata`; custom access token hook injects `user_role` JWT claim for RLS; column-level privilege blocks normal users from changing their own role; belt-and-suspenders trigger `prevent_role_escalation`; `/admin` page with user list, role toggle, ban/unban — all server-enforced (403 for non-admins); `scripts/seed-admin.ts` for initial admin bootstrap; `lib/auth/validate.ts` with 24 unit tests. Dashboard steps: apply migrations 001–003, enable custom access token hook, disable anonymous sign-ins.)
8. ~~**Meeting list actions** (pin, rename, delete)~~ **DONE** (Phase 8 complete — `pinned_at timestamptz null` column on meetings (migration 004) with composite sort index; list sort: pinned-first (most-recently-pinned on top), then created_at desc; per-row pin toggle (📌, optimistic), inline rename (optimistic, Enter to save / Escape to cancel), delete with confirmation dialog ("This permanently deletes the meeting…"); `DELETE /api/meetings/:id` removes audio from Storage before the row delete — Storage failure is logged + warned but does not block the row delete; `PATCH /api/meetings/:id` for rename; `PATCH /api/meetings/:id/pin` for pin toggle; all routes ownership-checked server-side. Apply migration 004 in Supabase dashboard.)
9. ~~**Admin user management**~~ **DONE** (Phase 9 complete — full `/admin` user-management UI + 5 API routes; all routes server-enforced by `requireAdmin` (reads `app_metadata.role`); pure guard functions in `lib/admin/guards.ts` + 21 unit tests; user list with pagination+search+meeting_count+last_sign_in_at; `PATCH /api/admin/users/:id/role` keeps app_metadata+profiles in sync; last-admin guard on demotion/disable/delete; `PATCH /api/admin/users/:id/status` enables/disables via ban_duration; `POST /api/admin/users/:id/reset-password` uses `auth.admin.generateLink({ type: 'recovery' })`; `DELETE /api/admin/users/:id` cleans up Storage audio files before deleting the auth user; UI shows "You" badge on self-row, disables self-action buttons, optimistic role/status updates with revert, confirmation dialogs for delete + password reset. See section 9c for full design.)
10. ~~**Admin operational — Area 1: Pipeline/Job Monitoring**~~ **DONE** (Phase 10a complete — `migrations/005_audit_logs.sql` (admin-readable, service-role writes, 4 indexes); `lib/admin/audit.ts` central `writeAuditLog()` fire-and-forget helper + `requestContext()` IP/UA extractor; `GET /api/admin/pipeline/overview` aggregate counts (pending/processing/done/failed/stuck) + avg_processing_secs; `GET /api/admin/pipeline/jobs?status=&page=&perPage=` metadata-only paginated list with owner email/username — NO transcript/notes content; `POST /api/admin/pipeline/:id/requeue` safe re-run: clears transcript_segments/todos/calendar_suggestions (transcript_chunks cascade), resets status to pending + clears summary/notes/language, writes audit log entry `meeting.requeue`, fires processMeeting() non-awaited; `/admin/pipeline` UI with status tiles (click to filter), filter tabs, jobs table with Requeue button per failed/stuck row, "Requeue all stuck/failed" with confirmation dialog, 10s auto-poll; 11 new unit tests in `tests/admin-pipeline.test.ts` (admin guard 403, requeue eligibility, audit entry structure). Apply migration 005 in Supabase dashboard.)

**Pending — Area 2 (Cost/Quota/Storage) and Area 3 (Audit Log) remain.**

Keep this section in sync with actual progress; mark phases done as we go.