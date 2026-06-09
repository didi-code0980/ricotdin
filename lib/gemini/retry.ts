// Exponential backoff retry for Gemini API calls.
// Retries on HTTP 429 (rate limit) and transient 5xx errors — both common on
// the free tier.

import { PipelineError } from './errors'

const MAX_RETRIES = 8
const BASE_DELAY_MS = 1_000
const MAX_DELAY_MS = 120_000

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    return /\b(429|500|502|503|504)\b/.test(err.message)
  }
  return false
}

export async function retryWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isRetryable(err) || attempt === MAX_RETRIES) break

      const jitter = Math.random() * 1_000
      const delay = Math.min(BASE_DELAY_MS * 2 ** attempt + jitter, MAX_DELAY_MS)
      console.warn(
        `[gemini] attempt ${attempt + 1} failed (${(err as Error).message}); ` +
          `retrying in ${Math.round(delay)}ms`,
      )
      await new Promise((res) => setTimeout(res, delay))
    }
  }
  const msg =
    lastErr instanceof Error ? lastErr.message : String(lastErr)
  throw new PipelineError(`Gemini call failed after ${MAX_RETRIES + 1} attempts: ${msg}`, lastErr)
}
