# Chatbot (RAG) Module (RAG)

**Module prefix:** RAG  
**Status:** ✅ Done (Phase 5 + RAG-04)  
**Key files:** `lib/rag/retrieve.ts`, `lib/rag/scope.ts`, `lib/gemini/answer.ts`, `app/api/chat/route.ts`, `components/ChatPanel.tsx`, `app/(routes)/chat/page.tsx`, `app/(routes)/meetings/folder/[id]/page.tsx`

---

## Overview

The RAG Chatbot module lets users ask natural-language questions about their meeting(s). Answers are grounded entirely in the transcript (no hallucinations) and every answer cites the exact timestamp(s) from which it was derived. Questions can be scoped to a single meeting or asked cross-meeting from a dedicated chat page.

---

## Features

### RAG-01 — Q&A scope
**Status:** ✅ Done

**User Story**  
As a user, I want to ask questions within one or across multiple meetings to look things up by the scope I need.

**Use Cases**

**Single-meeting scope (from `/meetings/[id]`):**
1. User opens the Chat panel in the meeting detail page.
2. The chat panel is pre-scoped to `meeting_id = [id]`.
3. RAG retrieval filters `transcript_chunks` by `meeting_id`.
4. Questions are answered only from that meeting's transcript.

**Cross-meeting scope (from `/chat`):**
1. User navigates to `/chat`.
2. No meeting filter is applied; `match_transcript_chunks` RPC searches across ALL of the user's meetings (owned + shared via COM-05).
3. Answers cite which meeting + timestamp each piece of evidence came from.

**Folder scope (from `/meetings/folder/[id]`) — RAG-04:**
1. User opens a folder in the meeting list.
2. A chat panel pre-scoped to that folder is shown alongside the meetings.
3. RAG retrieval is filtered to the accessible meetings in the folder.
4. See RAG-04 section for full detail.

**Frontend**
- `ChatPanel` component accepts `meetingId?`, `folderId?`, `folderName?`, and `meetingTitles?` props.
- When `meetingId` is provided, questions are scoped to that meeting.
- When `folderId` is provided, badge shows "Asking within {folderName}"; citations show `{meetingTitle} @ mm:ss`.
- When on `/chat` (neither), the panel shows "Ask anything about your meetings."
- Chat input with send button + Enter-to-send keyboard shortcut.

**Backend**
- `POST /api/chat` accepts `{ message, meetingId?, folderId? }` — at most one of meetingId/folderId.
- If `meetingId` is provided, RAG retrieval is filtered to that meeting.
- If `folderId` is provided, retrieval is filtered to the accessible meetings in the folder.
- If absent, retrieval is cross-meeting (RLS-scoped to the authenticated user).

---

### RAG-02 — Grounded answers
**Status:** ✅ Done

**User Story**  
As a user, I want the chatbot to answer only from the transcript and say "not found" when missing, to avoid hallucinations.

**Use Cases**
1. User asks a question.
2. System embeds the question and retrieves the top-K most relevant `transcript_chunks`.
3. Retrieved chunks + the question are sent to Gemini with an explicit instruction: "Answer ONLY from the provided context. If the answer is not in the context, say you could not find that information."
4. Gemini returns a structured JSON answer: `{ answer, citations: [{ chunk_id, timestamp }] }`.
5. Any `chunk_id` values Gemini invents (not in the retrieved set) are silently dropped (citation validation).
6. If the retrieved chunks contain no relevant information, the answer is "not found."

**Frontend**
- Answer displayed as plain text (no markdown rendering to avoid injection).
- "Not found" response styled as a muted info message.
- Citation chips shown below the answer (see RAG-03).

**Backend**
- `lib/gemini/answer.ts` — builds the grounded-QA prompt, calls Gemini JSON mode.
- Citation validation loop: filters out any `chunk_id` not present in the retrieved set.
- `lib/rag/retrieve.ts` — embeds query → `match_transcript_chunks` RPC with `user-client` (RLS enforces ownership).

---

### RAG-03 — Citations & history
**Status:** ✅ Done

**User Story**  
As a user, I want every answer to cite the exact timestamp and save history so I can verify and revisit.

**Use Cases**
1. Every answer includes citation chips showing `mm:ss` timestamps.
2. Clicking a citation chip in the meeting-scoped chat seeks the audio player to that timestamp.
3. All messages (user + assistant) are persisted to `chat_messages` (FK: `chat_sessions.id`).
4. On re-opening a meeting's chat panel, previous conversation history is loaded.
5. Cross-meeting citations show meeting title + timestamp.

**Frontend**
- Citation chips rendered as clickable `<button>` elements below the answer text.
- In single-meeting view: clicking a chip calls `audioRef.currentTime = timestamp`.
- In cross-meeting view: citation shows `{meetingTitle} @ mm:ss`.
- Chat history loaded on mount via `GET /api/chat?meetingId=...` or `GET /api/chat` (cross-meeting session).
- Optimistic message appending (user message appears instantly; assistant answer appears when streaming completes).

**Backend**
- `chat_sessions` table: `id, user_id, meeting_id (nullable), created_at`.
- `chat_messages` table: `id, session_id, role (user|assistant), content, citations jsonb, created_at`.
- `POST /api/chat` — creates/reuses session, persists user message, runs RAG pipeline, persists assistant response.
- `GET /api/chat?sessionId=...` — returns message history (ownership-checked).
- `match_transcript_chunks` Postgres RPC — cosine similarity search, returns `chunk_id, chunk_text, start_time, end_time, meeting_id`.

---

---

### RAG-04 — Folder-scoped chat
**Status:** ✅ Done

**User Story**  
As a user, I want to ask questions scoped to a specific folder so I can query only the meetings in that collection.

**Use Cases**
1. User opens a folder at `/meetings/folder/[id]`.
2. A "Folder chat" panel is shown alongside the meeting list.
3. User types a question. The system retrieves context only from meetings in the folder that the user can access.
4. Answers cite `{meetingTitle} @ mm:ss`; clicking navigates to that meeting at the cited timestamp.
5. Quota: one agent query is deducted from the asker's balance (actor-pays, same as global chat). Blocked at zero balance.
6. Chat history for each folder session is persisted and loaded on mount.
7. If the folder has no accessible meetings, a friendly message is returned (no quota deducted).

**Frontend**
- `ChatPanel` receives `folderId`, `folderName`, `meetingTitles` (meeting_id→title map), and `onCitationClick` (navigate to meeting at timestamp).
- Badge: "Asking within {folderName}".
- Citation chips: `{meetingTitle} @ mm:ss`; clicking calls `router.push(/meetings/{meeting_id}?t={seconds})`.
- Blocked state (402): "You have used all your agent queries."
- Panel is mounted only when the folder has ≥ 1 accessible meeting (empty state handled by the folder page).

**Backend**
- `POST /api/chat { message, folderId }`:
  1. `validateChatScope` — rejects if both meetingId + folderId set.
  2. `checkFolderAccess(db, folderId, userId, 'viewer')` — 403 if not accessible.
  3. User-scoped client queries `meetings WHERE folder_id = folderId` → RLS auto-filters to accessible meetings.
  4. `deriveMeetingIds(null, folderMeetingIds)` → array for retrieval filter.
  5. Empty folder → persist friendly reply, skip quota + Gemini.
  6. QUO-03 gate (same block as meeting/global scope — actor-pays).
  7. `retrieveContext({ meetingIds: [...] })` → `match_transcript_chunks` with `filter_meeting_ids uuid[]`.
  8. `answerWithContext` → grounded answer + citation validation (unchanged).
- `GET /api/chat?folderId=` — returns most recent session + messages for the folder (folder access checked).
- `chat_sessions.folder_id` nullable FK (migration 018) — scope derivation: meeting_id set → meeting; folder_id set → folder; both null → global.
- `match_transcript_chunks` RPC updated: `filter_meeting_id uuid` → `filter_meeting_ids uuid[]`; `WHERE ... = ANY(filter_meeting_ids)`.
- Pure helper `lib/rag/scope.ts`: `deriveMeetingIds()` + `validateChatScope()` — 12 unit tests.

---

## Data Flow

```
User sends question
  → POST /api/chat { message, meetingId? | folderId? }
      → validateChatScope()                  → reject if both set
      → access check (meeting or folder)     → 403 if denied
      [folder scope only]
      → user-scoped query: meetings WHERE folder_id=X  → accessible meeting IDs
      → deriveMeetingIds()                   → meetingIds filter (null=global)
      → embedText(message)                   → 768-dim vector
      → match_transcript_chunks RPC          → top-K chunks (RLS + meetingIds filter)
      → QUO-03 quota gate                    → 402 if balance=0 (actor-pays)
      → lib/gemini/answer.ts                 → Gemini JSON answer
          → citation validation (drop invented chunk_ids)
      → persist chat_messages (user + assistant)
      → return { answer, citations }
  → ChatPanel renders answer + citation chips
  → Citation click:
      single-meeting → audio seek
      folder/global  → navigate to /meetings/{id}?t={seconds}
```

## Dependencies

- **Depends on:** PRP-06 (embeddings), PRP-03 (transcript segments with timestamps), AUT-04 (RLS), PRO-06 (folders), COM-05 (can_access_meeting / shared folders), QUO-03 (agent-query quota)
- **Blocks:** nothing downstream; this is a leaf feature
