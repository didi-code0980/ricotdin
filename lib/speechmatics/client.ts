// SERVER ONLY — reads the Speechmatics API key from the DB key pool (with env fallback).
// Import only from /app/api or server /lib.

import { getActiveKeys } from '@/lib/keys/provider'

const BASE_URL = 'https://asr.api.speechmatics.com'

async function getApiKey(): Promise<string> {
  const keys = await getActiveKeys('speechmatics')
  if (keys.length === 0) {
    throw new Error(
      'No active Speechmatics API key found. ' +
      'Add one via the admin keys UI or set SPEECHMATICS_API_KEY in the environment.',
    )
  }
  return keys[0]
}

/**
 * Make an authenticated request to the Speechmatics API.
 * Throws on non-2xx responses with the status code and body text included.
 *
 * Pass `body` as FormData for multipart endpoints (job submission) or as a
 * string for JSON bodies. Omit for GET requests.
 */
export async function speechmaticsRequest<T>(
  method: string,
  path: string,
  body?: FormData | string,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await getApiKey()}`,
  }

  // Only set Content-Type for string bodies; FormData sets its own boundary.
  if (typeof body === 'string') {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Speechmatics API ${method} ${path} failed with ${res.status}: ${text.slice(0, 300)}`,
    )
  }

  return res.json() as Promise<T>
}
