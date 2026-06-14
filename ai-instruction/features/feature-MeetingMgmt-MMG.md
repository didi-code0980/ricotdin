# Meeting Management Module (MMG)

**Module prefix:** MMG  
**Status:** ✅ Done (Phase 8)  
**Key files:** `app/(routes)/meetings/page.tsx`, `app/api/meetings/route.ts`, `app/api/meetings/[id]/route.ts`, `app/api/meetings/[id]/pin/route.ts`, `migrations/004_meetings_pinned.sql`

---

## Overview

The Meeting Management module is the central hub for the user's meeting library. It provides a paginated list of all meetings with status indicators, and per-meeting actions: rename (inline), pin to top, and delete with storage cleanup. Sort order puts pinned meetings first, most-recently-pinned on top, then newest-first for the rest.

---

## Features

### MMG-01 — Meeting list
**Status:** ✅ Done

**User Story**  
As a user, I want to see my meetings with status so I know which ones finished processing.

**Use Cases**
1. User navigates to `/meetings` (or is redirected there after login).
2. Page fetches all meetings belonging to the user, sorted: pinned first (most-recently-pinned on top), then `created_at DESC`.
3. Each row shows: title, status badge (Pending / Processing / Done / Failed), created date, pin indicator.
4. Meetings in `processing` state cause the page to auto-poll every 3 seconds.
5. When a `processing` meeting transitions to `done` or `failed`, the badge updates without manual refresh.
6. User clicks a meeting row → navigates to `/meetings/[id]`.

**Frontend**
- `GET /api/meetings` returns list for the current user (RLS-scoped via anon key).
- Status badge: color-coded (Pending=grey, Processing=animated blue, Done=green, Failed=red).
- 3-second polling interval when any meeting is in `processing` state; stops when all settled.
- Empty-state illustration shown when the user has no meetings.

**Backend**
- `GET /api/meetings` — returns all meetings for `auth.uid()`, ordered by `pinned_at DESC NULLS LAST, created_at DESC`.
- RLS enforces user isolation (anon key only sees own rows).
- Index: `meetings_user_pin_sort ON meetings (user_id, pinned_at DESC NULLS LAST, created_at DESC)`.

---

### MMG-02 — Rename meeting
**Status:** ✅ Done

**User Story**  
As a user, I want to rename a meeting to identify it later.

**Use Cases**
1. User clicks the meeting title in the list → title becomes an inline text input.
2. User types a new name.
3. Pressing Enter or blurring the input commits: `PATCH /api/meetings/:id { title }` → optimistic update.
4. Pressing Escape cancels; original title is restored.
5. Empty title is rejected client-side (reverts to original).
6. On API error, the optimistic title is reverted and an error toast is shown.

**Frontend**
- Inline edit: `contentEditable` div or controlled `<input>` toggled by a click.
- Optimistic: title updates immediately; reverts on error.
- Keyboard: Enter = commit, Escape = cancel.
- Rename also accessible from the meeting detail page header.

**Backend**
- `PATCH /api/meetings/:id` — ownership-checked, updates `title` column.
- Validates: title must be a non-empty string, max 200 characters.
- Returns updated meeting row.

---

### MMG-03 — Pin meeting
**Status:** ✅ Done

**User Story**  
As a user, I want to pin important meetings to the top for quick access.

**Use Cases**
1. User clicks the pin icon (📌) on a meeting row.
2. If unpinned → pin: `PATCH /api/meetings/:id/pin { pinned: true }` sets `pinned_at = now()`.
3. If pinned → unpin: `PATCH /api/meetings/:id/pin { pinned: false }` sets `pinned_at = null`.
4. List re-sorts immediately (optimistic): pinned meetings appear at top, ordered by most-recently-pinned first.
5. Pin icon is filled/highlighted on pinned meetings.

**Frontend**
- Pin toggle button per row (📌 icon, active state when pinned).
- Optimistic sort update: meeting moves to/from the pinned section instantly.
- On API error, the pin state is reverted.

**Backend**
- `PATCH /api/meetings/:id/pin` — ownership-checked.
- Body: `{ pinned: boolean }`.
- Sets `pinned_at = NOW()` (pin) or `pinned_at = NULL` (unpin).
- Returns updated meeting row with new `pinned_at` value.
- Schema: `pinned_at timestamptz NULL` (migration 004).

---

### MMG-04 — Delete meeting
**Status:** ✅ Done

**User Story**  
As a user, I want to delete a meeting with its audio file (with confirmation) to clean up unneeded data.

**Use Cases**
1. User clicks **Delete** on a meeting row.
2. A confirmation dialog appears: "This permanently deletes the meeting, its transcript, and the audio recording."
3. User confirms → `DELETE /api/meetings/:id`.
4. Server reads `meetings.audio_path`, attempts to delete the file from Supabase Storage bucket `recordings`.
5. If storage deletion fails, it is logged and returned as a `warning` in the response — but the row delete always proceeds.
6. DB row deletion cascades: `transcript_segments`, `transcript_chunks`, `todos`, `calendar_suggestions`, `chat_sessions`, `chat_messages` are all removed.
7. Meeting disappears from the list (optimistic removal after confirmed API success).

**Frontend**
- Delete button per meeting row (with trash icon).
- Confirmation dialog with meeting title and clear warning text.
- Optimistic removal from list after API success.
- If response contains a `warning` field, show a non-blocking toast: "Meeting deleted, but audio file may remain in storage."

**Backend**
- `DELETE /api/meetings/:id` — ownership-checked.
- Step 1: read `audio_path` from the meeting row.
- Step 2: `serviceRoleClient.storage.from('recordings').remove([audio_path])` — failure is logged, not thrown.
- Step 3: `DELETE FROM meetings WHERE id = :id AND user_id = auth.uid()` — cascades all child rows.
- Returns `{ success: true, warning?: string }`.

---

## Data Flow

```
/meetings page
  → GET /api/meetings (polling 3s if any in processing)
  → renders meeting list sorted by pin/date

Pin toggle
  → PATCH /api/meetings/:id/pin { pinned }
  → optimistic re-sort

Rename
  → PATCH /api/meetings/:id { title }
  → optimistic title update

Delete (confirmed)
  → DELETE /api/meetings/:id
      → storage.remove(audio_path)  [best-effort]
      → DELETE row + cascade
  → meeting removed from list
```

## Schema Notes

- `meetings.pinned_at timestamptz NULL` — added in migration 004.
- Sort index: `meetings_user_pin_sort (user_id, pinned_at DESC NULLS LAST, created_at DESC)`.
- All child tables have `ON DELETE CASCADE` FK to `meetings.id`.

## Dependencies

- **Depends on:** PRP-01 (meetings table), AUT-04 (data isolation)
- **Blocks:** nothing downstream; leaf management module
