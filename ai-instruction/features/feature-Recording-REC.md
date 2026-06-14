# Recording Module (REC)

**Module prefix:** REC  
**Status:** ✅ Done (Phase 1)  
**Key files:** `components/RecorderUI.tsx`, `lib/audio/capture.ts`, `lib/audio/support.ts`, `hooks/useRecorder.ts` (inside `lib/audio/useRecorder.ts`), `app/(routes)/record/`

---

## Overview

The Recording module handles in-browser audio capture. It mixes tab/system audio (from screen-share) with the user's microphone into a single audio-only stream, then hands the recorded blob off to the upload module. It is the entry point for every meeting.

---

## Features

### REC-01 — Toggle recording & mix sources
**Status:** ✅ Done

**User Story**  
As a user, I want to start/stop recording and mix tab + mic into one stream so I capture both sides of the conversation.

**Use Cases**
1. User navigates to `/record`.
2. User clicks **Start Recording** → browser prompts for screen-share (must include audio) and microphone permissions.
3. System acquires both `displayMedia` and `userMedia` streams.
4. Web Audio API `AudioContext` mixes the two tracks via `MediaStreamAudioSourceNode` → `MediaStreamDestinationNode`.
5. `MediaRecorder` records the mixed stream in WebM/Opus format.
6. User clicks **Stop Recording** → `MediaRecorder.stop()` fires; all chunks are assembled into a `Blob`.
7. The recorded blob is passed to the upload flow (PRP-01).

**Frontend**
- `/record` page with `RecorderUI` component.
- `useRecorder` hook manages state machine: `idle → requesting → recording → stopped`.
- Start/Stop buttons with live recording timer display.
- Visualizer or status indicator showing active recording.
- On stop, transitions to upload/processing flow automatically.

**Backend**
- Pure browser-side feature; no server involvement during capture.
- Depends on browser `getDisplayMedia` API (Chromium only).
- Mixed stream is held in memory until stop; then handed to the upload route.

---

### REC-02 — Audio-only capture
**Status:** ✅ Done

**User Story**  
As a user, I want the system to store audio only and drop video to protect privacy and save storage.

**Use Cases**
1. When `getDisplayMedia` returns a stream, the video track is immediately removed via `stream.getVideoTracks().forEach(t => t.stop())`.
2. Only audio tracks from both streams are mixed and recorded.
3. The resulting `Blob` contains audio data only (no video frames).

**Frontend**
- Handled transparently inside `useRecorder`/`capture.ts` — the user sees no video preview.
- The UI shows no video element; no indication that video was ever captured.

**Backend**
- No server-side enforcement needed; video is stripped client-side before any upload.
- Reduces storage size significantly (audio ≈ 1–5 MB/min vs. video ≈ 50+ MB/min).

---

### REC-03 — Missing-audio warning
**Status:** ✅ Done

**User Story**  
As a user, I want a warning when system audio isn't captured so I can enable "share audio" before the meeting.

**Use Cases**
1. User selects a screen/tab to share but forgets to tick "Share audio" in the browser dialog.
2. `getDisplayMedia` returns a stream with no audio tracks (or zero audio tracks).
3. UI surfaces a warning banner: "System audio not detected — please re-start and check 'Share audio'."
4. User can dismiss the warning and attempt recording with mic-only, or stop and retry.

**Frontend**
- `useRecorder` / `capture.ts` inspects the display stream after acquisition.
- `lib/audio/support.ts` exports a helper that checks for audio tracks.
- Warning is shown as a non-blocking inline alert on the `/record` page (user can proceed with mic-only).
- `RecorderUI` renders the warning component when the flag is set.

**Backend**
- No server-side involvement; entirely client-side detection.

---

### REC-04 — Browser support
**Status:** ✅ Done

**User Story**  
As a Chrome/Edge user, I want to be notified if my browser is unsupported so I know to switch.

**Use Cases**
1. User opens `/record` in an unsupported browser (Firefox, Safari, mobile).
2. `lib/audio/support.ts` checks for `navigator.mediaDevices.getDisplayMedia` availability.
3. If absent, the `/record` page renders a full-page unsupported-browser notice instead of the recorder UI.
4. Notice explains that Chrome or Edge is required and optionally offers a download link.

**Frontend**
- `lib/audio/support.ts`: `isBrowserSupported()` → boolean.
- `/record` page wraps `RecorderUI` in a conditional; if unsupported, renders `<UnsupportedBrowserNotice />`.
- No recording controls are shown at all on unsupported browsers.

**Backend**
- No server-side involvement.

---

## Data Flow

```
User action (Start)
  → getDisplayMedia() + getUserMedia()
  → AudioContext mix
  → MediaRecorder (WebM/Opus)
  → [Stop] → Blob
  → Upload flow (PRP-01)
```

## Dependencies

- **Depends on:** none (REC-04 is the base check; REC-01 depends on it passing)
- **Blocks:** PRP-01 (upload requires a recorded blob)
