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

2. **Enable Anonymous sign-ins**
   - Dashboard → Authentication → Providers → Anonymous sign-ins → Enable
   - This is TEMPORARY; Phase 7 replaces it with real login (email/password or OAuth).
   - The anonymous session provides a real `auth.uid()` so RLS policies work correctly.

## 9b. Anonymous auth — TEMPORARY note

The app currently uses Supabase's anonymous sign-in (`supabase.auth.signInAnonymously()`)
to give each browser session a real `auth.uid()`. This is initialized in
`components/AuthBootstrap.tsx` (mounted in root layout) and in
`lib/supabase/auth.ts` (`ensureAnonymousSession()`).

**This is intentional and temporary.** Phase 7 replaces it with real auth
(email/password or OAuth). Until then:
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only; anonymous JWTs only flow to/from
  the browser client and the `/api` route handlers that validate them via the anon key.
- Do not remove anonymous sign-in until Phase 7 is complete.

## 10. Working agreement (how to collaborate with me)

- Work in **small increments**, one clear goal per change, each with a concrete
  "done" check. Do not attempt the whole app in one go.
- After each working increment, **commit to git** with a clear message.
- **Write tests** for non-trivial logic: Gemini JSON parsing, audio chunking,
  vector search wiring, transcript stitching.
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
6. Calendar suggestions + todos surfaced in UI (`.ics` download).
7. Auth, hardening, deploy (+ a cron ping to keep Supabase from auto-pausing).

Keep this section in sync with actual progress; mark phases done as we go.