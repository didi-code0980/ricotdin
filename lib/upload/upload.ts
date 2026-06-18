// Client-side upload helpers.
// All functions run in the browser only — do not import from server code.

import { browserClient } from '@/lib/supabase/browser'
import { getAccessToken } from '@/lib/supabase/auth'

const BUCKET = 'recordings'

export interface RecordingMeta {
  /** Duration in seconds. Pass 0 when unknown (e.g. uploaded files). */
  durationSeconds: number
  /** ISO 8601 timestamp of when the meeting took place (recording start or user-selected date). */
  startedAt: string
  /** MIME type of the audio blob, used as the Storage contentType header. */
  mimeType?: string
  /** 'recorded' (default) or 'uploaded'. Stored in meetings.source. */
  source?: 'recorded' | 'uploaded'
  /** File extension with leading dot, e.g. '.mp3'. Required for uploaded files so
   *  the storage path uses the correct extension. Defaults to '.webm' on the server. */
  fileExtension?: string
}

export interface UploadResult {
  meetingId: string
}

/**
 * Full upload flow for a single recording or uploaded file:
 * 1. Ensure auth session.
 * 2. POST /api/meetings → get signed upload URL.
 * 3. Upload blob directly to Supabase Storage (bypasses our server).
 * 4. POST /api/meetings/:id/uploaded → confirm + trigger pipeline.
 */
export async function uploadRecording(
  blob: Blob,
  meta: RecordingMeta,
): Promise<UploadResult> {
  const token = await getAccessToken()
  if (!token) throw new UploadError('Not authenticated. Please sign in.', 'auth')

  // Step 1: create meeting row + signed upload URL
  const createRes = await fetch('/api/meetings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      durationSeconds: meta.durationSeconds,
      startedAt: meta.startedAt,
      source: meta.source ?? 'recorded',
      fileExtension: meta.fileExtension,
    }),
  })

  if (!createRes.ok) {
    const body = await createRes.json().catch(() => ({ error: `HTTP ${createRes.status}` })) as { error?: string }
    throw new UploadError(body.error ?? `HTTP ${createRes.status}`, 'create')
  }

  const { meetingId, path, token: uploadToken } = (await createRes.json()) as {
    meetingId: string
    path: string
    token: string
  }

  // Step 2: upload blob directly to Supabase Storage
  const { error: uploadError } = await browserClient.storage
    .from(BUCKET)
    .uploadToSignedUrl(path, uploadToken, blob, {
      contentType: meta.mimeType || blob.type || 'audio/webm',
    })

  if (uploadError) {
    throw new UploadError(`Storage upload failed: ${uploadError.message}`, 'upload')
  }

  // Step 3: confirm upload to server — triggers ffprobe validation + pipeline
  const confirmRes = await fetch(`/api/meetings/${meetingId}/uploaded`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!confirmRes.ok) {
    const body = await confirmRes.json().catch(() => ({ error: `HTTP ${confirmRes.status}` })) as { error?: string }
    // For uploaded files the server may return 422 (bad file type / too large).
    // Surface these as real errors so the UI can show a useful message.
    throw new UploadError(body.error ?? `HTTP ${confirmRes.status}`, 'confirm')
  }

  return { meetingId }
}

/** Typed error that carries which step failed for better UI messaging. */
export class UploadError extends Error {
  constructor(
    message: string,
    public readonly step: 'auth' | 'create' | 'upload' | 'confirm',
  ) {
    super(message)
    this.name = 'UploadError'
  }
}
