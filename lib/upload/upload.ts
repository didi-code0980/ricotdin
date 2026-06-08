// Client-side upload helpers.
// All functions run in the browser only — do not import from server code.

import { browserClient } from '@/lib/supabase/browser'
import { ensureAnonymousSession } from '@/lib/supabase/auth'

const BUCKET = 'recordings'

export interface RecordingMeta {
  durationSeconds: number
  startedAt: string   // ISO 8601
  mimeType?: string
}

export interface UploadResult {
  meetingId: string
}

/**
 * Full upload flow for a single recording:
 * 1. Ensure auth session (anonymous if needed).
 * 2. POST /api/meetings → get signed upload URL.
 * 3. Upload blob directly to Supabase Storage (bypasses our server).
 * 4. POST /api/meetings/:id/uploaded → confirm.
 */
export async function uploadRecording(
  blob: Blob,
  meta: RecordingMeta,
): Promise<UploadResult> {
  const token = await ensureAnonymousSession()

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

  // Step 3: confirm upload to server (non-fatal if this fails — row already exists)
  const confirmRes = await fetch(`/api/meetings/${meetingId}/uploaded`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!confirmRes.ok) {
    // Log but don't throw — meeting row + file both exist; pipeline can still run
    const body = await confirmRes.json().catch(() => ({ error: `HTTP ${confirmRes.status}` })) as { error?: string }
    console.warn('[upload] confirm step failed (non-fatal):', body.error)
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
