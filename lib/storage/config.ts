// SERVER ONLY — resolves R2 object-storage credentials from the DB (storage_config),
// with a 30s in-memory cache and env-var fallback. Never expose secrets to the client.
//
// Precedence: newest active storage_config row (provider='r2') → R2_* env vars.
// Mirrors the API-key resolution pattern in lib/keys/provider.ts.

import { createServerClient } from '@/lib/supabase/server'
import { decryptSecret } from '@/lib/crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Fully-resolved R2 credentials ready to build an S3Client. */
export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  /** Where the config came from — for diagnostics only. */
  source: 'db' | 'env'
}

/** Raw storage_config row shape (server-side only — includes ciphertext). */
export interface StorageConfigRow {
  id: string
  created_at: string
  updated_at: string
  provider: string
  label: string
  account_id: string
  access_key_id: string
  bucket: string
  secret_ciphertext: string
  secret_iv: string
  secret_auth_tag: string
  secret_last4: string
  status: 'active' | 'disabled'
  disabled_reason: string | null
  last_used_at: string | null
  created_by: string | null
}

/** Masked shape safe to return from the admin API — NEVER includes ciphertext. */
export interface MaskedStorageConfig {
  id: string
  created_at: string
  updated_at: string
  provider: string
  label: string
  account_id: string
  access_key_id: string
  bucket: string
  secret_last4: string
  status: 'active' | 'disabled'
  disabled_reason: string | null
  last_used_at: string | null
}

// ---------------------------------------------------------------------------
// Pure helpers (no I/O — unit-tested)
// ---------------------------------------------------------------------------

/** Columns safe to SELECT/return — deliberately excludes the ciphertext trio. */
export const STORAGE_SAFE_SELECT =
  'id, created_at, updated_at, provider, label, account_id, access_key_id, bucket, secret_last4, status, disabled_reason, last_used_at' as const

/**
 * Strip a raw row down to the masked shape. Guarantees ciphertext / iv / auth_tag
 * and created_by are never present on the returned object.
 */
export function maskStorageRow(
  row: Partial<StorageConfigRow> & { id: string },
): MaskedStorageConfig {
  return {
    id: row.id,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
    provider: row.provider ?? 'r2',
    label: row.label ?? '',
    account_id: row.account_id ?? '',
    access_key_id: row.access_key_id ?? '',
    bucket: row.bucket ?? '',
    secret_last4: row.secret_last4 ?? '',
    status: (row.status as 'active' | 'disabled') ?? 'active',
    disabled_reason: row.disabled_reason ?? null,
    last_used_at: row.last_used_at ?? null,
  }
}

/** Read R2 credentials from the environment, or null if incompletely configured. */
export function r2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID?.trim()
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim()
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim()
  const bucket = env.R2_BUCKET?.trim()
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return { accountId, accessKeyId, secretAccessKey, bucket, source: 'env' }
}

// ---------------------------------------------------------------------------
// Cached resolver (DB → env fallback)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000
let _cache: { config: R2Config | null; expiresAt: number } | null = null

/** Expire the storage-config cache. Call after any mutation. */
export function invalidateStorageConfigCache(): void {
  _cache = null
}

/**
 * Resolve the active R2 configuration.
 * Newest active storage_config row wins; falls back to R2_* env vars; null if
 * neither is configured (callers surface a clear "storage not configured" error).
 */
export async function getR2Config(): Promise<R2Config | null> {
  const now = Date.now()
  if (_cache && _cache.expiresAt > now) return _cache.config

  let resolved: R2Config | null = null

  try {
    const db = createServerClient()
    const { data } = await db
      .from('storage_config')
      .select('*')
      .eq('provider', 'r2')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data) {
      const row = data as unknown as StorageConfigRow
      const secretAccessKey = decryptSecret({
        ciphertext: row.secret_ciphertext,
        iv: row.secret_iv,
        authTag: row.secret_auth_tag,
      })
      resolved = {
        accountId: row.account_id,
        accessKeyId: row.access_key_id,
        secretAccessKey,
        bucket: row.bucket,
        source: 'db',
      }
    }
  } catch {
    // DB unreachable or decrypt failed — fall through to env so the app keeps working.
    resolved = null
  }

  if (!resolved) resolved = r2ConfigFromEnv()

  _cache = { config: resolved, expiresAt: now + CACHE_TTL_MS }
  return resolved
}
