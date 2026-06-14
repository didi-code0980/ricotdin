# Processing Pipeline Module (PRP)

**Module prefix:** PRP  
**Status:** ✅ Done (Phase 2–3)  
**Key files:** `lib/pipeline/processMeeting.ts`, `lib/pipeline/audioChunk.ts`, `lib/pipeline/chunk.ts`, `lib/gemini/analyze.ts`, `lib/gemini/client.ts`, `app/api/meetings/`, `app/api/meetings/[id]/process/`

---

## Overview

The Processing Pipeline takes a recorded audio file all the way from browser upload to a fully analysed meeting record. It handles: direct-to-storage upload, server-side transcoding, Gemini AI analysis (transcript + summary + notes + todos + calendar mentions), RAG embedding, and status tracking with retry logic.

---

## Features

### PRP-01 — Audio upload
**Status:** ✅ Done

**User Story**  
As the system, I want to upload the file directly from the browser via a signed URL to avoid server body limits.

**Use Cases**
1. After recording stops, the browser requests a signed upload URL from the server.
2. `POST /api/meetings` creates a `meetings` row (status=`pending`) and returns a presigned Supabase Storage URL.
3. Browser uploads the WebM blob directly to Supabase Storage (bucket: `recordings`) using the signed URL — no data passes through the Next.js server.
4. On upload completion, browser calls `POST /api/meetings/:id/uploaded` to notify the server.
5. Server triggers the async processing pipeline.

**Frontend**
- Upload progress bar shown on `/record` or redirect to `/meetings/[id]` with pending state.
- Uses `lib/upload/useUpload.ts` hook to manage upload state.
- On success, navigates to the meeting detail page.

**Backend**
- `POST /api/meetings` — creates DB row, generates Supabase signed upload URL (service role).
- `POST /api/meetings/:id/uploaded` — verifies ownership, sets status to `processing`, fires `processMeeting()` fire-and-forget.
- Storage bucket: `recordings` (private, requires service role to access).

---

### PRP-02 — Format transcoding
**Status:** ✅ Done

**User Story**  
As the system, I want to transcode audio to an AI-supported format so the pipeline doesn't fail silently.

**Use Cases**
1. Server downloads the uploaded WebM/Opus file from Supabase Storage.
2. `lib/pipeline/processMeeting.ts` calls ffmpeg to transcode: WebM → mono 16 kHz MP3.
3. Transcoded MP3 is written to a temp file and passed to the Gemini Files API.
4. If ffmpeg is absent, the pipeline fails with a clear error message (not silently).

**Frontend**
- No UI impact; meeting remains in `processing` status during transcoding.
- If ffmpeg is missing, meeting transitions to `failed` with an actionable error message.

**Backend**
- `lib/pipeline/processMeeting.ts` shells out to ffmpeg via child process.
- Output: `audio-{id}.mp3` in the OS temp directory; deleted after pipeline completes.
- Failure: sets `meetings.status='failed'` + `meetings.error_message` with details.

---

### PRP-03 — Transcript generation
**Status:** ✅ Done

**User Story**  
As a user, I want a transcript with timestamps + speaker diarization so I know who said what and when.

**Use Cases**
1. Server uploads MP3 to the Gemini Files API (temporary staging, ~48h retention).
2. `lib/gemini/analyze.ts` sends the file reference + structured JSON schema prompt to `gemini-2.5-flash`.
3. Gemini returns a JSON array of transcript segments: `{ speaker, start_time, end_time, text }`.
4. Segments are written to `transcript_segments` table.
5. If Gemini returns 0 segments, the pipeline fails (guard against silent empty transcripts).

**Frontend**
- Transcript displayed in meeting detail page (MTD-01).
- Speaker labels shown per segment.
- Timestamps shown as clickable `mm:ss` links that seek the audio player.

**Backend**
- `lib/gemini/analyze.ts` — calls Gemini with JSON mode + fixed response schema.
- Response parsing is defensive: strips code fences, validates structure before use.
- Segments written to `transcript_segments` (FK: `meeting_id`, `ON DELETE CASCADE`).
- Retry with exponential backoff on HTTP 429.

---

### PRP-04 — Summary & meeting notes
**Status:** ✅ Done

**User Story**  
As a user, I want a structured summary and notes so I can grasp the content without re-reading everything.

**Use Cases**
1. Gemini analysis (same API call as PRP-03, single unified prompt) returns `summary` and `notes` fields.
2. `summary` is a short paragraph (3–5 sentences) of what was discussed.
3. `notes` is structured markdown: key topics, decisions, next steps.
4. Both are stored in `meetings.summary` and `meetings.notes` columns.

**Frontend**
- Summary section shown at top of meeting detail page.
- Notes section renders markdown via `react-markdown` + `rehype-sanitize`.

**Backend**
- Both fields returned in the same Gemini JSON response as PRP-03 (one API call).
- Written to `meetings` table immediately after successful parse.
- Language of the meeting stored in `meetings.language`.

---

### PRP-05 — Extract to-dos & calendar mentions
**Status:** ✅ Done

**User Story**  
As a user, I want the system to auto-extract to-dos and calendar mentions so I don't miss post-meeting commitments.

**Use Cases**
1. Gemini analysis returns `todos` array: `{ text, assignee, due_date, segment_id }`.
2. Gemini analysis returns `calendar_suggestions` array: `{ title, proposed_at, description, segment_id }`.
3. Rows are written to `todos` and `calendar_suggestions` tables.
4. `due_date` and `proposed_at` are only set when explicitly mentioned; never fabricated.

**Frontend**
- To-dos listed in meeting detail with checkbox + assignee + due date.
- Calendar suggestions listed with title + date + "Download .ics" button.
- Both sections visible on the meeting detail page (MTD-01).

**Backend**
- Returned in the unified Gemini JSON response.
- Written to `todos` and `calendar_suggestions` tables (FK: `meeting_id`, cascade delete).
- `proposed_at` is `null` when Gemini cannot identify a specific datetime.

---

### PRP-06 — RAG embeddings
**Status:** ✅ Done

**User Story**  
As the system, I want to chunk the transcript and create embeddings to power semantic Q&A.

**Use Cases**
1. After segments are written, `lib/pipeline/chunk.ts` groups transcript segments into overlapping text chunks (~500 tokens each, with overlap).
2. Each chunk is embedded using Gemini's embedding model (`text-embedding-004`) at 768 dimensions.
3. Chunks + vectors are written to `transcript_chunks` table with `pgvector` column.
4. HNSW cosine index enables fast ANN similarity search.

**Frontend**
- No direct UI; enables the RAG chatbot (RAG-01 through RAG-03).

**Backend**
- `lib/pipeline/chunk.ts` — splits segments into chunks with stride overlap.
- `lib/gemini/client.ts` — `embedText()` calls `text-embedding-004` at `output_dimensionality: 768`.
- `transcript_chunks` table: `id, meeting_id, chunk_text, start_time, end_time, embedding vector(768)`.
- `match_transcript_chunks` Postgres RPC (cosine similarity, RLS-scoped to user).

---

### PRP-07 — Processing status & retry
**Status:** ✅ Done

**User Story**  
As a user, I want to see processing status and re-run on failure so I know progress and can recover a meeting.

**Use Cases**
1. `meetings.status` cycles: `pending → processing → done | failed`.
2. Meeting list page polls every 3 seconds for meetings in `processing` state.
3. If status becomes `failed`, meeting detail shows an error message + **Re-run** button.
4. Re-run button calls `POST /api/meetings/:id/process` which resets status and retriggers the pipeline.
5. On HTTP 429 from Gemini, pipeline retries with exponential backoff (3 attempts, 1s/2s/4s delays).
6. Fallback: if `gemini-2.5-flash` fails repeatedly, retries with `gemini-2.5-flash-lite`.

**Frontend**
- Status badge on meeting list and detail page: Pending / Processing (animated) / Done / Failed.
- 3-second polling on the meetings list page while any meeting is in `processing`.
- Failed state shows `error_message` and a Re-run button.

**Backend**
- `app/api/meetings/:id/process` — protected route; resets status, fires pipeline.
- Guard: does not mark `done` if 0 transcript segments were produced.
- Error stored in `meetings.error_message` (user-friendly + log detail).

---

### PRP-08 — Long-meeting support
**Status:** ✅ Done

**User Story**  
As a user with a long meeting, I want the system to auto-split and stitch the transcript by timestamp so long files process.

**Use Cases**
1. Before sending to Gemini, `lib/pipeline/audioChunk.ts` checks audio duration.
2. Files longer than ~20–25 minutes are split into overlapping segments using ffmpeg.
3. Each chunk is sent to Gemini separately.
4. Transcripts from all chunks are stitched together by time offset (so timestamps remain continuous).
5. Combined transcript is written to `transcript_segments` as a unified set.

**Frontend**
- Transparent to the user; meeting appears as a single unified transcript regardless of chunk count.

**Backend**
- `lib/pipeline/audioChunk.ts` — ffmpeg-based splitting with configurable chunk duration.
- Time offsets are tracked and added to each chunk's segment timestamps before stitching.
- Single unified `processMeeting` call handles the full loop.

---

## Data Flow

```
Recorded Blob (browser)
  → POST /api/meetings          → meetings row (status=pending)
  → Signed URL upload           → Supabase Storage (recordings/)
  → POST /api/meetings/:id/uploaded
  → processMeeting() [async]
      → download audio from Storage
      → ffmpeg transcode → MP3
      → [if long] split into chunks
      → Gemini Files API upload
      → gemini-2.5-flash (JSON mode)
          → transcript_segments
          → summary + notes → meetings
          → todos → todos table
          → calendar_suggestions table
      → chunk + embed → transcript_chunks
      → meetings.status = 'done'
```

## Dependencies

- **Depends on:** REC-02 (audio blob from recording)
- **Blocks:** MTD-01, RAG-01, CAL-01, MMG-01
