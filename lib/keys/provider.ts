// SERVER ONLY — loads active provider API keys, with in-memory cache and env fallback.
//
// Cache: results are memoised per provider for KEY_CACHE_TTL_MS (30 s).
// This app runs as a long-lived single process, so an in-memory cache is safe.
// Key mutations call invalidateKeyCache() for immediate effect.
//
// Fallback order:
//   1. Active DB rows for the provider (decrypted at call time).
//   2. Env-var key(s) for the provider (if DB returns nothing).
//
// The env fallback keeps everything working during migration and in environments
// that have not yet configured DB keys.

import { createServerClient } from '@/lib/supabase/server'
import { decryptSecret } from '@/lib/crypto'

const KEY_CACHE_TTL_MS = 30_000

type CacheEntry = { keys: string[]; expiresAt: number }
const _cache = new Map<string, CacheEntry>()

/** Env-var fallback keys for a provider (mirrors the existing env loading logic). */
function envKeys(provider: string): string[] {
  if (provider === 'gemini') {
    const seen = new Set<string>()
    const out: string[] = []
    const push = (raw?: string) => {
      const t = raw?.trim()
      if (t && !seen.has(t)) { seen.add(t); out.push(t) }
    }
    const csv = process.env.GEMINI_API_KEYS
    if (csv) csv.split(',').forEach(push)
    for (let i = 1; i <= 20; i++) push(process.env[`GEMINI_API_KEY_${i}`])
    push(process.env.GEMINI_API_KEY)
    return out
  }
  if (provider === 'speechmatics') {
    const k = process.env.SPEECHMATICS_API_KEY?.trim()
    return k ? [k] : []
  }
  return []
}

/**
 * Return decrypted active API keys for the given provider.
 * DB keys are preferred; env vars are used when no DB keys exist.
 */
export async function getActiveKeys(provider: string): Promise<string[]> {
  const now = Date.now()
  const cached = _cache.get(provider)
  if (cached && cached.expiresAt > now) return cached.keys

  let keys: string[] = []

  try {
    const db = createServerClient()
    const { data } = await db
      .from('provider_keys')
      .select('id, key_ciphertext, key_iv, key_auth_tag')
      .eq('provider', provider)
      .eq('status', 'active')
      .order('created_at', { ascending: true })

    if (data && data.length > 0) {
      for (const row of data) {
        try {
          keys.push(
            decryptSecret({
              ciphertext: row.key_ciphertext as string,
              iv:         row.key_iv as string,
              authTag:    row.key_auth_tag as string,
            }),
          )
        } catch {
          console.error(`[keys] failed to decrypt key ${row.id} for provider "${provider}"`)
        }
      }
    }
  } catch (err) {
    console.error(`[keys] DB lookup failed for provider "${provider}":`, err)
  }

  if (keys.length === 0) keys = envKeys(provider)

  _cache.set(provider, { keys, expiresAt: now + KEY_CACHE_TTL_MS })
  return keys
}

/** Force-expire the cache for a provider (or all providers if omitted). */
export function invalidateKeyCache(provider?: string): void {
  if (provider) _cache.delete(provider)
  else _cache.clear()
}
