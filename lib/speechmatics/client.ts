// SERVER ONLY — reads SPEECHMATICS_API_KEY. Import only from /app/api or server /lib.
// Thin fetch wrapper around the Speechmatics REST API.

const BASE_URL = 'https://asr.api.speechmatics.com'

function getApiKey(): string {
  const key = process.env.SPEECHMATICS_API_KEY
  if (!key) throw new Error('SPEECHMATICS_API_KEY is not set in environment')
  return key
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
    Authorization: `Bearer ${getApiKey()}`,
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
