// SERVER ONLY — loads active config values from admin_config, with in-memory cache
// and env-var fallback.
//
// The admin_config table is a generic key-value store. For API keys, the config_key
// convention is '<provider>_api_key' (e.g. 'gemini_api_key', 'speechmatics_api_key').
//
// Cache: per config_key, 30-second TTL. Invalidated immediately after mutations.
// Fallback: env vars are used when no active DB rows exist for a config_key.

import { createServerClient } from '@/lib/supabase/server'
import { decryptSecret } from '@/lib/crypto'

const KEY_CACHE_TTL_MS = 30_000

// Mapping from provider shorthand → admin_config config_key
const PROVIDER_CONFIG_KEY: Record<string, string> = {
  gemini:       'gemini_api_key',
  speechmatics: 'speechmatics_api_key',
}

function toConfigKey(provider: string): string {
  return PROVIDER_CONFIG_KEY[provider] ?? `${provider}_api_key`
}

type CacheEntry = { keys: string[]; expiresAt: number }
const _cache = new Map<string, CacheEntry>()

/** Env-var fallback keys for a provider (mirrors the original env loading logic). */
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
 * Return decrypted active values for the given provider from admin_config.
 * Falls back to env vars when no DB rows exist.
 *
 * @param provider  Short provider name: 'gemini' | 'speechmatics'
 */
export async function getActiveKeys(provider: string): Promise<string[]> {
  const configKey = toConfigKey(provider)
  const now = Date.now()

  const cached = _cache.get(configKey)
  if (cached && cached.expiresAt > now) return cached.keys

  let keys: string[] = []

  try {
    const db = createServerClient()
    const { data } = await db
      .from('admin_config')
      .select('id, value_ciphertext, value_iv, value_auth_tag')
      .eq('config_key', configKey)
      .eq('status', 'active')
      .order('created_at', { ascending: true })

    if (data && data.length > 0) {
      for (const row of data) {
        try {
          keys.push(
            decryptSecret({
              ciphertext: row.value_ciphertext as string,
              iv:         row.value_iv as string,
              authTag:    row.value_auth_tag as string,
            }),
          )
        } catch {
          console.error(`[keys] failed to decrypt admin_config row ${row.id} (${configKey})`)
        }
      }
    }
  } catch (err) {
    console.error(`[keys] DB lookup failed for config_key "${configKey}":`, err)
  }

  if (keys.length === 0) keys = envKeys(provider)

  _cache.set(configKey, { keys, expiresAt: now + KEY_CACHE_TTL_MS })
  return keys
}

/** Expire the cache for a provider (or all providers). Call after key mutations. */
export function invalidateKeyCache(provider?: string): void {
  if (provider) _cache.delete(toConfigKey(provider))
  else _cache.clear()
}
