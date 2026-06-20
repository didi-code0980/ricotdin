// GET  /api/admin/keys        — list all keys (masked, never ciphertext)
// POST /api/admin/keys        — add a new key (encrypt + store, return masked record)
//
// SECURITY:
// - Both endpoints require admin role (requireAdmin).
// - GET never returns key_ciphertext, key_iv, key_auth_tag, or created_by.
// - POST receives the plaintext key once, encrypts it server-side, and never
//   echoes the key or ciphertext back in the response.
// - KEY_ENCRYPTION_SECRET and all decrypted key values are server-only.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/server'
import { encryptSecret } from '@/lib/crypto'
import { invalidateKeyCache } from '@/lib/keys/provider'
import { writeAuditLog, requestContext } from '@/lib/admin/audit'

const ALLOWED_PROVIDERS = ['gemini', 'speechmatics'] as const
type AllowedProvider = typeof ALLOWED_PROVIDERS[number]

// Columns that are safe to return to the client — never the raw key material.
const SAFE_SELECT =
  'id, created_at, updated_at, provider, label, last4, status, disabled_reason, last_used_at'

export async function GET(req: NextRequest) {
  let caller: { id: string; email?: string }
  try { caller = await requireAdmin(req) } catch (res) { return res as NextResponse }
  void caller

  const db = createServerClient()
  const { data, error } = await db
    .from('provider_keys')
    .select(SAFE_SELECT)
    .order('provider', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[admin/keys] list failed:', error.message)
    return NextResponse.json({ error: 'Failed to list keys.' }, { status: 500 })
  }

  return NextResponse.json({ keys: data ?? [] })
}

export async function POST(req: NextRequest) {
  let caller: { id: string; email?: string }
  try { caller = await requireAdmin(req) } catch (res) { return res as NextResponse }

  let body: { provider?: unknown; label?: unknown; key?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) }

  const provider = typeof body.provider === 'string' ? body.provider.trim() : ''
  const label    = typeof body.label    === 'string' ? body.label.trim()    : ''
  const key      = typeof body.key      === 'string' ? body.key.trim()      : ''

  if (!ALLOWED_PROVIDERS.includes(provider as AllowedProvider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${ALLOWED_PROVIDERS.join(', ')}.` },
      { status: 422 },
    )
  }
  if (!label) {
    return NextResponse.json({ error: 'label is required.' }, { status: 422 })
  }
  if (label.length > 80) {
    return NextResponse.json({ error: 'label must be 80 chars or fewer.' }, { status: 422 })
  }
  if (!key) {
    return NextResponse.json({ error: 'key is required.' }, { status: 422 })
  }
  if (key.length < 8) {
    return NextResponse.json({ error: 'key is too short (minimum 8 characters).' }, { status: 422 })
  }

  const last4 = key.slice(-4)

  let encrypted: { ciphertext: string; iv: string; authTag: string }
  try {
    encrypted = encryptSecret(key)
  } catch (err) {
    console.error('[admin/keys] encryption failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: 'Failed to encrypt key. Verify KEY_ENCRYPTION_SECRET is configured.' },
      { status: 500 },
    )
  }

  const db = createServerClient()
  const { data: row, error: insertErr } = await db
    .from('provider_keys')
    .insert({
      provider,
      label,
      key_ciphertext: encrypted.ciphertext,
      key_iv:         encrypted.iv,
      key_auth_tag:   encrypted.authTag,
      last4,
      status: 'active',
      created_by: caller.id,
    })
    .select(SAFE_SELECT)
    .single()

  if (insertErr || !row) {
    console.error('[admin/keys] insert failed:', insertErr?.message)
    return NextResponse.json({ error: 'Failed to store key.' }, { status: 500 })
  }

  // Invalidate cache so the new key is picked up on the next provider call.
  invalidateKeyCache(provider)

  void writeAuditLog({
    actorId:    caller.id,
    actorEmail: caller.email ?? '',
    action:     'provider_key.create',
    targetType: 'provider_key',
    targetId:   row.id,
    metadata:   { provider, label },
    ...requestContext(req),
  })

  return NextResponse.json({ key: row }, { status: 201 })
}
