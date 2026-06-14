# Calendar & To-do Module (CAL)

**Module prefix:** CAL  
**Status:** ✅ Done (Phase 6)  
**Key files:** `lib/ics/index.ts`, `app/api/calendar-suggestions/[id]/ics/route.ts`, `app/api/calendar-suggestions/[id]/route.ts`, `app/api/todos/[id]/route.ts`

---

## Overview

The Calendar & To-do module surfaces AI-extracted action items and calendar events from meetings. Users can download calendar suggestions as `.ics` files for import into any calendar app (Google Calendar, Outlook, Apple Calendar), check off or dismiss to-dos, and view assignee/due-date metadata. No Google OAuth or automatic event creation — the MVP approach is intentional.

---

## Features

### CAL-01 — Export .ics
**Status:** ✅ Done

**User Story**  
As a user, I want to export calendar mentions as an .ics file to import into any calendar app.

**Use Cases**
1. Meeting is processed; Gemini extracts calendar mentions into `calendar_suggestions`.
2. Meeting detail page shows each calendar suggestion with title, description, and proposed date/time.
3. User clicks **Download .ics** next to a suggestion.
4. Browser fetches `GET /api/calendar-suggestions/:id/ics` with a Bearer token.
5. Server builds a RFC 5545-compliant `.ics` file and returns it as `Content-Type: text/calendar`.
6. Browser triggers a file download (`.ics` file).
7. User imports the `.ics` file into their calendar app manually.

**Frontend**
- Each `calendar_suggestion` row rendered with: title, formatted proposed date, description snippet.
- **Download .ics** button performs a `fetch()` with Bearer auth header, creates a blob URL, and triggers download.
- Helper text: "No automatic syncing — import the file manually into your calendar."
- Button is only enabled when `proposed_at` is not null (see CAL-02).

**Backend**
- `GET /api/calendar-suggestions/:id/ics` — ownership-checked via meeting FK.
- `lib/ics/index.ts` — pure RFC 5545 ICS builder (no external deps): escaping, line folding, UTC timestamps.
- Returns `Content-Disposition: attachment; filename="event.ics"`.
- Returns 422 if `proposed_at` is null (never fabricate a datetime).

---

### CAL-02 — Truthful time handling
**Status:** ✅ Done

**User Story**  
As a user, I want the system not to fabricate times (all-day or disable export) so exported entries stay truthful.

**Use Cases**
1. Gemini extracts a calendar mention but the exact time is not stated in the meeting (e.g. "next Tuesday").
2. `proposed_at` is stored as `null` in `calendar_suggestions`.
3. The `.ics` download button is shown as a disabled `<span>` with a tooltip: "No specific time mentioned."
4. When `proposed_at` is a date only (no time component), the ICS entry is created as an all-day event (`DTSTART;VALUE=DATE`).
5. When `proposed_at` includes a time, the ICS entry uses a full UTC timestamp (`DTSTART:YYYYMMDDTHHmmssZ`).

**Frontend**
- UI distinguishes between: has time → enabled download, no time → disabled with tooltip.
- Metadata row always shown; "No due date" rendered for null dates.

**Backend**
- `lib/ics/index.ts` — branching logic: all-day vs. datetime based on whether `proposed_at` has a time component.
- The 422 guard on the API route prevents any download attempt when `proposed_at` is null.

---

### CAL-03 — To-do management
**Status:** ✅ Done

**User Story**  
As a user, I want to manage to-dos with assignee and due date to track action items.

**Use Cases**
1. Meeting detail page shows extracted to-dos with: task text, assignee (if mentioned), due date (if mentioned).
2. User checks a to-do (marks as done) → optimistic UI update → `PATCH /api/todos/:id { status: 'done' }`.
3. User dismisses a to-do → `PATCH /api/todos/:id { status: 'dismissed' }`.
4. Past-due date is styled orange/amber with a ⚠ prefix to draw attention.
5. Dismissed to-dos are hidden from the active list.

**Frontend**
- To-do component: checkbox (pending/done toggle), assignee chip, due-date badge.
- Past-due detection: compares `due_date` against current date client-side.
- Dismiss button with a small ×/skip icon.
- All mutations are optimistic with error revert.
- Active to-dos shown first; dismissed to-dos collapsed or hidden.

**Backend**
- `PATCH /api/todos/:id` — ownership-checked, validates `status` enum.
- Valid values: `pending`, `done`, `dismissed`.
- Returns the updated todo row.
- `todos` table: `id, meeting_id, text, assignee, due_date, status, segment_id`.

---

## Data Flow

```
Meeting processing (PRP-05)
  → calendar_suggestions rows (title, proposed_at, description, segment_id)
  → todos rows (text, assignee, due_date, status, segment_id)

Meeting detail page
  → renders todos list + calendar suggestions list

Calendar export
  → GET /api/calendar-suggestions/:id/ics
      → ownership check
      → lib/ics/index.ts → RFC 5545 .ics string
      → Content-Disposition: attachment

Todo action
  → PATCH /api/todos/:id { status }
      → DB update
      → return updated row
```

## Dependencies

- **Depends on:** PRP-05 (extracted todos + calendar mentions)
- **Blocks:** nothing downstream; leaf module for action-item surfaces
