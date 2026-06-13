// SERVER ONLY — reads Gemini API keys which must never reach the browser.
//
// Multi-key pool with round-robin (LRU) selection, per-key cooldown tracking,
// and automatic rotation on 429 / 5xx / network errors.
//
// Usage — stateless calls (text generation, embeddings):
//   import { geminiPool } from './pool'
//   const result = await geminiPool.call(ai => ai.models.generateContent({...}))
//
// Usage — Files-API sessions (upload → generate → delete):
//   The entire sequence MUST be in one call() so the same key is used throughout.
//   Gemini files are scoped to the key that uploaded them.
//   const result = await geminiPool.call(async ai => {
//     const file = await ai.files.upload({...})
//     try {
//       return await ai.models.generateContent({...})
//     } finally {
//       ai.files.delete({ name: file.name }).catch(() => {})
//     }
//   })
//
// Key sources (checked in order, de-duplicated):
//   1. GEMINI_API_KEYS=key1,key2,key3   (comma-separated)
//   2. GEMINI_API_KEY_1, GEMINI_API_KEY_2, ... GEMINI_API_KEY_20
//   3. GEMINI_API_KEY  (legacy single key — still works)
//
// Tunables (all optional, have sane defaults):
//   GEMINI_DEFAULT_COOLDOWN_MS  default 60000
//   GEMINI_BASE_BACKOFF_MS      default 500
//   GEMINI_MAX_BACKOFF_MS       default 8000
//   GEMINI_MAX_ATTEMPTS         default 0 (= min(keys*2, 16))

import { GoogleGenAI } from '@google/genai'
import { PipelineError } from './errors'

// ---------------------------------------------------------------------------
// Exported error type
// ---------------------------------------------------------------------------

export class AllGeminiKeysExhaustedError extends PipelineError {
  constructor(keyCount: number, attempts: number) {
    super(
      `All ${keyCount} Gemini key(s) exhausted after ${attempts} attempt(s). ` +
        `Check key validity and quota. The meeting will be marked failed and can be re-run.`,
    )
    this.name = 'AllGeminiKeysExhaustedError'
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface PoolConfig {
  defaultCooldownMs: number
  baseBackoffMs: number
  maxBackoffMs: number
  /** 0 = auto: min(keys.length * 2, 16) */
  maxAttempts: number
}

function readConfig(): PoolConfig {
  const n = (key: string, fallback: number) =>
    parseInt(process.env[key] ?? '', 10) || fallback
  return {
    defaultCooldownMs: n('GEMINI_DEFAULT_COOLDOWN_MS', 60_000),
    baseBackoffMs:     n('GEMINI_BASE_BACKOFF_MS', 500),
    maxBackoffMs:      n('GEMINI_MAX_BACKOFF_MS', 8_000),
    maxAttempts:       n('GEMINI_MAX_ATTEMPTS', 0),
  }
}

// ---------------------------------------------------------------------------
// Per-key state
// ---------------------------------------------------------------------------

interface KeyState {
  readonly key: string
  /** 1-based; used in log messages only — never log the raw key value. */
  readonly index: number
  /** Epoch ms after which this key can be used again. 0 = no cooldown. */
  cooldownUntil: number
  /** Epoch ms of last use (0 = never used). Drives LRU selection. */
  lastUsedAt: number
  consecutiveFailures: number
  /** 401/403 → permanently skip for this process lifetime. */
  disabled: boolean
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

type ErrorClass = 'rate-limit' | 'invalid-key' | 'bad-request' | 'transient' | 'unknown'

function classifyError(err: unknown): ErrorClass {
  // PipelineError = our own validation / parse failure — surface immediately.
  if (err instanceof PipelineError) return 'bad-request'

  const msg = err instanceof Error ? err.message : String(err)

  if (/\b429\b/.test(msg) || /RESOURCE_EXHAUSTED/i.test(msg) || /quota/i.test(msg)) {
    return 'rate-limit'
  }
  if (
    /\b(401|403)\b/.test(msg) ||
    /API_KEY_INVALID/i.test(msg) ||
    /invalid.api.key/i.test(msg) ||
    /permission.denied/i.test(msg)
  ) {
    return 'invalid-key'
  }
  if (/\b400\b/.test(msg)) {
    return 'bad-request'
  }
  if (
    /\b(500|502|503|504)\b/.test(msg) ||
    /UNAVAILABLE/i.test(msg) ||
    /INTERNAL/i.test(msg) ||
    /ECONNRESET/i.test(msg) ||
    /ETIMEDOUT/i.test(msg) ||
    /fetch failed/i.test(msg) ||
    /network/i.test(msg)
  ) {
    return 'transient'
  }
  return 'unknown'
}

/** Extract a Retry-After duration in ms from the error message, if present. */
function parseRetryAfterMs(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err)
  // Matches: "retryDelay: 30s", "retry after 30", "Retry-After: 30"
  const m = msg.match(/retry[_\-\s]?(?:after|delay)[:\s=]+(\d+)/i)
  if (m) {
    const s = parseInt(m[1], 10)
    if (!isNaN(s) && s > 0) return s * 1_000
  }
  return null
}

function maskKey(key: string): string {
  return key.length >= 8 ? `...${key.slice(-4)}` : '...????'
}

function jitteredDelay(base: number, attempt: number, cap: number): number {
  const exp = Math.min(base * 2 ** attempt, cap)
  return exp * (0.75 + Math.random() * 0.5) // ±25% jitter
}

// ---------------------------------------------------------------------------
// Pool class
// ---------------------------------------------------------------------------

class GeminiKeyPool {
  private readonly keys: KeyState[]
  private readonly cfg: PoolConfig

  constructor(keys: string[], cfg: PoolConfig) {
    if (keys.length === 0) {
      throw new Error(
        'No Gemini API keys configured. ' +
          'Set GEMINI_API_KEYS (comma-separated) or GEMINI_API_KEY in .env.local.',
      )
    }
    this.keys = keys.map((k, i) => ({
      key: k,
      index: i + 1,
      cooldownUntil: 0,
      lastUsedAt: 0,
      consecutiveFailures: 0,
      disabled: false,
    }))
    this.cfg = cfg
    console.log(`[gemini pool] initialised with ${keys.length} key(s)`)
  }

  /** Least-recently-used key that is neither cooling down nor disabled. */
  private nextKey(): KeyState | null {
    const now = Date.now()
    const healthy = this.keys.filter(k => !k.disabled && k.cooldownUntil <= now)
    if (healthy.length === 0) return null
    return healthy.reduce((best, k) => (k.lastUsedAt < best.lastUsedAt ? k : best))
  }

  /** Epoch ms when the next cooldown expires, or null if all keys are disabled. */
  private soonestCooldownMs(): number | null {
    const cooling = this.keys.filter(k => !k.disabled && k.cooldownUntil > Date.now())
    if (cooling.length === 0) return null
    return Math.min(...cooling.map(k => k.cooldownUntil))
  }

  /**
   * Execute `fn` with a healthy GoogleGenAI client.
   *
   * On retryable errors the pool puts the used key on cooldown (or disables it),
   * picks the next healthy key via LRU, and retries `fn` from scratch.
   *
   * For Files-API sessions the entire upload+generate+delete sequence should be
   * inside a single call() so the same key is used throughout (Gemini files are
   * scoped to the uploading key).
   */
  async call<T>(fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
    const maxAttempts =
      this.cfg.maxAttempts > 0
        ? this.cfg.maxAttempts
        : Math.min(this.keys.length * 2, 16)

    let lastErr: unknown

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const keyState = this.nextKey()

      if (!keyState) {
        // All keys are either cooling down or permanently disabled.
        const nextMs = this.soonestCooldownMs()
        if (nextMs === null) {
          // Every key is permanently disabled — no recovery possible.
          throw new AllGeminiKeysExhaustedError(this.keys.length, attempt)
        }
        const waitMs = Math.max(0, nextMs - Date.now()) + 50
        console.warn(
          `[gemini pool] all keys on cooldown; waiting ${Math.round(waitMs / 1_000)}s ` +
            `for next available key (attempt ${attempt + 1}/${maxAttempts})`,
        )
        await new Promise(r => setTimeout(r, waitMs))
        // Don't consume an attempt slot for a pure cooldown wait.
        attempt--
        continue
      }

      keyState.lastUsedAt = Date.now()
      const ai = new GoogleGenAI({ apiKey: keyState.key })

      try {
        const result = await fn(ai)
        keyState.consecutiveFailures = 0
        return result
      } catch (err) {
        lastErr = err
        const errClass = classifyError(err)

        if (errClass === 'bad-request') {
          throw err // our bug or non-recoverable — surface immediately
        }

        const snippet = (err instanceof Error ? err.message : String(err)).slice(0, 120)

        if (errClass === 'rate-limit') {
          const cooldownMs = parseRetryAfterMs(err) ?? this.cfg.defaultCooldownMs
          keyState.cooldownUntil = Date.now() + cooldownMs
          keyState.consecutiveFailures++
          console.warn(
            `[gemini pool] key #${keyState.index} rate-limited; ` +
              `cooldown ${Math.round(cooldownMs / 1_000)}s; ` +
              `attempt ${attempt + 1}/${maxAttempts} — rotating to next key`,
          )
        } else if (errClass === 'invalid-key') {
          keyState.disabled = true
          console.warn(
            `[gemini pool] key #${keyState.index} (${maskKey(keyState.key)}) ` +
              `rejected as invalid (401/403) — permanently disabled; rotating`,
          )
        } else {
          // transient or unknown — try the next key without a cooldown
          keyState.consecutiveFailures++
          console.warn(
            `[gemini pool] key #${keyState.index} transient error on ` +
              `attempt ${attempt + 1}/${maxAttempts}: ${snippet}`,
          )
        }

        if (attempt < maxAttempts - 1) {
          const delay = jitteredDelay(this.cfg.baseBackoffMs, attempt, this.cfg.maxBackoffMs)
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }

    throw new AllGeminiKeysExhaustedError(this.keys.length, maxAttempts)
  }
}

// ---------------------------------------------------------------------------
// Key loading
// ---------------------------------------------------------------------------

function loadKeys(): string[] {
  const seen = new Set<string>()
  const keys: string[] = []

  const push = (raw: string | undefined) => {
    if (!raw) return
    const trimmed = raw.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      keys.push(trimmed)
    }
  }

  // 1. GEMINI_API_KEYS=key1,key2,key3
  const csv = process.env.GEMINI_API_KEYS
  if (csv) csv.split(',').forEach(push)

  // 2. GEMINI_API_KEY_1 ... GEMINI_API_KEY_20
  for (let i = 1; i <= 20; i++) {
    push(process.env[`GEMINI_API_KEY_${i}`])
  }

  // 3. GEMINI_API_KEY (legacy single key)
  push(process.env.GEMINI_API_KEY)

  return keys
}

// ---------------------------------------------------------------------------
// Lazy singleton — shared across all requests in the same Node.js process.
// Initialized on first call() so it doesn't fail during next build.
// ---------------------------------------------------------------------------

let _pool: GeminiKeyPool | null = null

function getPool(): GeminiKeyPool {
  if (!_pool) _pool = new GeminiKeyPool(loadKeys(), readConfig())
  return _pool
}

export const geminiPool = {
  call<T>(fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
    return getPool().call(fn)
  },
}
