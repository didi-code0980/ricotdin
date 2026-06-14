# Proposed Module (PRO)

**Module prefix:** PRO  
**Status:** ❌ Not started (Phase B — post-MVP)  
**Priority:** High (PRO-01 to PRO-04), Medium (PRO-05 to PRO-07), Low (PRO-08)

---

## Overview

The Proposed module contains planned enhancements beyond the core MVP. These features increase the product's usefulness and stickiness but are explicitly out of MVP scope. They should not be built without an explicit decision to proceed.

---

## Features

### PRO-01 — Auto summary email
**Priority:** High | **Status:** ❌ Not started

**User Story**  
As a user, I want to automatically receive a summary + action items email after processing so I don't have to open the app.

**Use Cases**
1. Meeting finishes processing (status transitions to `done`).
2. System automatically sends an email to the meeting owner.
3. Email contains: meeting title, summary, list of to-dos with assignees, calendar suggestions.
4. Email is sent once; no re-send on re-queue unless explicitly triggered.

**Frontend**
- User preferences: opt-in/opt-out toggle in account settings.
- Email template: branded HTML with summary, todos list, calendar suggestions.

**Backend**
- Hook in `processMeeting.ts` — after status=done, fire email send.
- Email provider: Resend / SendGrid / Supabase SMTP.
- Template: server-rendered HTML.
- Unsubscribe link in footer.
- Depends on: PRP-04 (summary), PRP-05 (todos).

---

### PRO-02 — Google Calendar sync
**Priority:** High | **Status:** ❌ Not started

**User Story**  
As a user, I want to create Google Calendar events in one tap via OAuth instead of only .ics.

**Use Cases**
1. User connects their Google account via OAuth 2.0 in account settings.
2. On meeting detail page, calendar suggestion shows a **"Add to Google Calendar"** button.
3. Clicking it creates the event directly via the Google Calendar API.
4. User receives confirmation in the UI.

**Frontend**
- OAuth connect button in settings.
- Per-suggestion "Add to Google Calendar" button (enabled when Google account connected).
- Replaces/supplements the `.ics` download button.

**Backend**
- Google OAuth 2.0 flow: store refresh token per user.
- `POST /api/calendar/:id/google-sync` → Google Calendar API event create.
- Depends on: PRP-05, CAL-01. Explicitly out of MVP scope.

---

### PRO-03 — To-do reminders
**Priority:** High | **Status:** ❌ Not started

**User Story**  
As a user, I want reminders when a to-do is due via email/push so I don't forget.

**Use Cases**
1. To-do has a `due_date` set.
2. System sends a reminder email/push notification 24 hours before due.
3. User can snooze or dismiss reminders.

**Frontend**
- Reminder settings per to-do (snooze duration, disable).
- Push notification opt-in (browser notification permission).

**Backend**
- Background job (cron) to check for due to-dos and send reminders.
- Push: Web Push API / FCM.
- Depends on: PRP-05, CAL-03.

---

### PRO-04 — Speaker naming
**Priority:** High | **Status:** ❌ Not started

**User Story**  
As a user, I want to set real speaker names instead of "Speaker 1" and remember them across meetings.

**Use Cases**
1. Meeting detail transcript shows "Speaker 1", "Speaker 2", etc.
2. User clicks a speaker label → inline edit → types real name.
3. `PATCH /api/meetings/:id/speakers` saves the mapping.
4. Optionally: system learns and auto-applies the mapping across future meetings from the same context.
5. Transcript display replaces generic labels with real names everywhere.

**Frontend**
- Inline speaker label editor in the transcript.
- Speaker legend panel (list of all speakers in this meeting with name fields).
- Real names reflected immediately in transcript display.

**Backend**
- `speaker_mappings` table: `id, meeting_id, speaker_label, display_name, user_id`.
- API to CRUD speaker mappings.
- Transcript view joins speaker_mappings when rendering.
- Depends on: PRP-03 (diarization).

---

### PRO-05 — Library-wide search
**Priority:** Medium | **Status:** ❌ Not started

**User Story**  
As a user, I want keyword + semantic search across all meetings for quick lookup.

**Use Cases**
1. User types a query in a global search bar.
2. System performs both keyword (full-text) and semantic (vector) search across all transcripts.
3. Results show meeting title, matching excerpt, timestamp, relevance score.
4. User clicks a result → navigates to the meeting detail at the relevant timestamp.

**Frontend**
- Global search bar (header or dedicated `/search` page).
- Result cards: meeting title, matched excerpt (highlighted), timestamp chip.

**Backend**
- Full-text search: Postgres `tsvector` on `transcript_segments.text`.
- Semantic search: `match_transcript_chunks` RPC (already exists).
- Result fusion: rank by combined score.
- Depends on: PRP-06 (embeddings).

---

### PRO-06 — Organization & export
**Priority:** Medium | **Status:** ❌ Not started

**User Story**  
As a user, I want to organize by folder/tag, edit transcript/notes, and export PDF/Markdown.

**Use Cases**
1. User creates folders and tags.
2. User assigns meetings to folders/tags.
3. User edits transcript text or meeting notes inline.
4. User exports a meeting as PDF or Markdown.

**Frontend**
- Folder sidebar in meetings list.
- Tag chips on meeting rows.
- Inline editing for notes (rich text editor).
- Export button with PDF/Markdown format selection.

**Backend**
- `folders` and `tags` tables.
- `PATCH /api/meetings/:id/notes` for notes editing.
- PDF export: server-side puppeteer or jsPDF.
- Markdown export: server-side string template.
- Depends on: MMG-01, MTD-01.

---

### PRO-07 — Desktop app
**Priority:** Medium | **Status:** ❌ Not started

**User Story**  
As a macOS user, I want a desktop app for stable system-audio capture and auto meeting detection.

**Use Cases**
1. User installs a native desktop app (Tauri-based).
2. App captures system audio natively without browser screen-share dialog.
3. App auto-detects when a meeting starts (Zoom/Meet/Teams process detection).
4. App records in the background without a browser tab.
5. App syncs recorded meetings to the web backend.

**Frontend (Desktop)**
- Tauri app with a minimal native UI.
- Menu bar icon for quick recording controls.
- Settings: audio device selection, auto-detection rules.

**Backend**
- Same backend API; desktop app authenticates via the same auth flow.
- Native audio capture: OS-level audio routing (CoreAudio on macOS).
- This is the highest-value technical upgrade if pursued seriously.

---

### PRO-08 — AI depth
**Priority:** Low | **Status:** ❌ Not started

**User Story**  
As a user, I want more accurate AI, multilingual support, meeting-type note templates, and cross-meeting insights.

**Use Cases**
1. Multilingual: detect meeting language, transcribe natively, optionally translate.
2. Note templates: "Sales call", "1:1", "Engineering standup" — each with a tailored summary structure.
3. Cross-meeting insights: trends, recurring topics, frequently assigned tasks.
4. Higher-accuracy transcription: route long/high-value meetings to Gemini Pro.

**Frontend**
- Language selector per meeting (or auto-detected).
- Template selector before or after processing.
- Insights dashboard (`/insights`).

**Backend**
- `meetings.language` column already exists (filled by PRP-03).
- Template: pass meeting type to the analysis prompt.
- Cross-meeting insights: aggregate queries over transcript data.
- Model routing: config flag to select Flash vs. Pro per meeting.

---

## Dependencies

All PRO features depend on core MVP features being stable. Suggested build order if pursuing:
1. PRO-04 (speaker naming) — high value, low risk
2. PRO-01 (summary email) — high value, low effort
3. PRO-02 (Google Calendar) — needs OAuth setup
4. PRO-05 (library search) — embeddings already exist
5. PRO-07 (desktop app) — major investment, highest ceiling
