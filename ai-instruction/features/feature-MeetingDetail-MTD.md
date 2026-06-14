# Meeting Detail Module (MTD)

**Module prefix:** MTD  
**Status:** ✅ Done (Phase 4)  
**Key files:** `app/(routes)/meetings/[id]/page.tsx`, `app/api/audio-url/[id]/route.ts`, `app/api/todos/[id]/route.ts`, `app/api/calendar-suggestions/[id]/route.ts`

---

## Overview

The Meeting Detail module presents all processing results for a single meeting on one page. It shows the transcript, summary, markdown notes, to-dos, calendar suggestions, and the original audio player — with click-to-seek navigation between the transcript and the audio.

---

## Features

### MTD-01 — Meeting detail page
**Status:** ✅ Done

**User Story**  
As a user, I want one page aggregating summary/notes/transcript/to-dos/calendar so I see all results in one place.

**Use Cases**
1. User clicks a meeting in the meeting list → navigates to `/meetings/[id]`.
2. Page fetches meeting data (status, summary, notes, todos, calendar_suggestions, transcript_segments).
3. If status is `pending` or `processing`, page shows a loading/in-flight state and polls every 3 seconds.
4. If status is `failed`, page shows error message + Re-run button.
5. If status is `done`, all sections are shown: Header, Audio Player, Summary, Notes, To-dos, Calendar, Transcript, Chat.

**Frontend**
- State machine: `loading → inflight (polls 3s) | failed | done`.
- Sections rendered in order: header (title, date, duration) → audio player → summary → notes (markdown) → todos → calendar suggestions → transcript → chat panel.
- Uses `react-markdown` + `rehype-sanitize` for notes rendering.
- `GET /api/meetings/:id` fetches all data in one call; includes child rows.

**Backend**
- `GET /api/meetings/:id` — ownership-checked; returns meeting + all child rows.
- Returns 404 if meeting not found or owned by a different user.
- No sensitive data (other users' meetings) is ever returned.

---

### MTD-02 — Audio player
**Status:** ✅ Done

**User Story**  
As a user, I want to click a timestamp in the transcript to seek to the exact audio segment.

**Use Cases**
1. Audio player loads via a signed URL (not a public URL) fetched from the server.
2. `GET /api/audio-url/:id` returns a short-lived signed URL from Supabase Storage.
3. Clicking any transcript timestamp seeks the `<audio>` element to that time.
4. Audio player shows playback position; transcript highlights the current segment while playing.

**Frontend**
- `<audio>` element with `currentTime` managed via a ref.
- Transcript timestamps are rendered as `<button>` elements that call `audioRef.current.currentTime = start_time`.
- Format: `mm:ss` (e.g. `02:14`).
- Signed URL fetched on page load and stored in component state.

**Backend**
- `GET /api/audio-url/:id` — checks ownership, then calls `supabase.storage.from('recordings').createSignedUrl(audio_path, 3600)`.
- Returns `{ url: string }`.
- URL expires after 1 hour; client re-fetches if playback fails due to expiry.

---

### MTD-03 — To-do interaction
**Status:** ✅ Done

**User Story**  
As a user, I want to check/skip to-dos and jump to the source transcript segment to verify context.

**Use Cases**
1. Each to-do is shown with a checkbox (done/undone) and a skip option.
2. User checks a to-do → optimistic UI update → `PATCH /api/todos/:id` with `{ status: 'done' }`.
3. User skips/dismisses a to-do → `PATCH /api/todos/:id` with `{ status: 'dismissed' }`.
4. If the to-do has a `segment_id`, a "jump to transcript" link seeks the audio and scrolls the transcript to that segment.
5. On API error, the optimistic update is reverted.

**Frontend**
- To-do list component with checkbox, assignee chip, due-date badge (orange/amber if past due with ⚠ prefix).
- Dismiss button removes the to-do from the active list (moves to a collapsed "dismissed" section or hides it).
- Jump link styled as a timestamp chip.
- All UI updates are optimistic (instant feedback, revert on error).

**Backend**
- `PATCH /api/todos/:id` — ownership-checked (via meeting FK), updates `status` column.
- Valid status values: `pending`, `done`, `dismissed`.
- Returns updated todo row.

---

## Data Flow

```
/meetings/[id] page load
  → GET /api/meetings/:id         → all meeting data
  → GET /api/audio-url/:id        → signed Storage URL
  → <audio src={signedUrl} />

Transcript timestamp click
  → audioRef.currentTime = start_time

Todo checkbox/dismiss
  → PATCH /api/todos/:id          → updated status
  → optimistic UI update
```

## Dependencies

- **Depends on:** PRP-03 (transcript), PRP-04 (summary/notes), PRP-05 (todos/calendar), PRP-01 (audio in storage)
- **Blocks:** RAG chatbot renders inside this page (RAG-01)
