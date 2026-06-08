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
2. Upload + storage (presigned URL, `meetings` row).
3. **Processing pipeline** (Gemini service layer, JSON output, chunking, retry, embeddings).
4. Results UI (summary / note / transcript / todos).
5. RAG chatbot (RPC search + grounded answers with citations).
6. Calendar suggestions + todos surfaced in UI (`.ics` download).
7. Auth, hardening, deploy (+ a cron ping to keep Supabase from auto-pausing).

Keep this section in sync with actual progress; mark phases done as we go.