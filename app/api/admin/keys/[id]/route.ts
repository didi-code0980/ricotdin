// PATCH  /api/admin/keys/:id  — enable or disable a key (with optional reason)
// DELETE /api/admin/keys/:id  — permanently remove a key
//
// SECURITY:
// - Both endpoints require admin role.
// - Neither endpoint returns ciphertext or plaintext key material.
// - Disabling or deleting the LAST active key for a provider is blocked.
// - All mutations are audit-logged with metadata: { provider, label } only —
//   never ciphertext, IV, auth tag, or plaintext.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/server'
import { isLastActiveKey } from '@/lib/keys/guards'
import { invalidateKeyCache } from '@/lib/keys/provider'
import { writeAuditLog, requestContext } from '@/lib/admin/audit'

const SAFE_SELECT =
  'id, created_at, updated_at, provider, label, last4, status, disabled_reason, last_used_at'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let caller: { id: string; email?: string }
  try { caller = await requireAdmin(req) } catch (res) { return res as NextResponse }

  const { id: keyId } = await params

  let body: { status?: unknown; disabled_reason?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) }

  if (body.status !== 'active' && body.status !== 'disabled') {
    return NextResponse.json(
      { error: 'status must be "active" or "disabled".' },
      { status: 422 },
    )
  }
  const newStatus = body.status as 'active' | 'disabled'
  const disabled_reason =
    typeof body.disabled_reason === 'string' ? body.disabled_reason.trim() || null : null

  const db = createServerClient()

  const { data: key } = await db
    .from('provider_keys')
    .select('id, provider, label, status')
    .eq('id', keyId)
    .maybeSingle()

  if (!key) return NextResponse.json({ error: 'Key not found.' }, { status: 404 })

  // Block disabling the last remaining active key for this provider.
  if (newStatus === 'disabled' && key.status === 'active') {
    const { count } = await db
      .from('provider_keys')
      .select('*', { count: 'exact', head: true })
      .eq('provider', key.provider as string)
      .eq('status', 'active')

    if (isLastActiveKey(count ?? 1)) {
      return NextResponse.json(
        {
          error:
            `Cannot disable the last active key for provider "${key.provider}". ` +
            'Add another key first.',
        },
        { status: 422 },
      )
    }
  }

  const { data: updated, error: updateErr } = await db
    .from('provider_keys')
    .update({
      status:          newStatus,
      disabled_reason: newStatus === 'active' ? null : disabled_reason,
    })
    .eq('id', keyId)
    .select(SAFE_SELECT)
    .single()

  if (updateErr || !updated) {
    console.error('[admin/keys] update failed:', updateErr?.message)
    return NextResponse.json({ error: 'Failed to update key.' }, { status: 500 })
  }

  invalidateKeyCache(key.provider as string)

  const action = newStatus === 'active' ? 'provider_key.enable' : 'provider_key.disable'
  void writeAuditLog({
    actorId:    caller.id,
    actorEmail: caller.email ?? '',
    action,
    targetType: 'provider_key',
    targetId:   keyId,
    metadata: {
      provider: key.provider,
      label:    key.label,
      ...(disabled_reason ? { disabled_reason } : {}),
    },
    ...requestContext(req),
  })

  return NextResponse.json({ key: updated })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let caller: { id: string; email?: string }
  try { caller = await requireAdmin(req) } catch (res) { return res as NextResponse }

  const { id: keyId } = await params
  const db = createServerClient()

  const { data: key } = await db
    .from('provider_keys')
    .select('id, provider, label, status')
    .eq('id', keyId)
    .maybeSingle()

  if (!key) return NextResponse.json({ error: 'Key not found.' }, { status: 404 })

  // Block deleting the last active key.
  if (key.status === 'active') {
    const { count } = await db
      .from('provider_keys')
      .select('*', { count: 'exact', head: true })
      .eq('provider', key.provider as string)
      .eq('status', 'active')

    if (isLastActiveKey(count ?? 1)) {
      return NextResponse.json(
        {
          error:
            `Cannot delete the last active key for provider "${key.provider}". ` +
            'Disable it or add another key first.',
        },
        { status: 422 },
      )
    }
  }

  const { error: deleteErr } = await db
    .from('provider_keys')
    .delete()
    .eq('id', keyId)

  if (deleteErr) {
    console.error('[admin/keys] delete failed:', deleteErr.message)
    return NextResponse.json({ error: 'Failed to delete key.' }, { status: 500 })
  }

  invalidateKeyCache(key.provider as string)

  void writeAuditLog({
    actorId:    caller.id,
    actorEmail: caller.email ?? '',
    action:     'provider_key.delete',
    targetType: 'provider_key',
    targetId:   keyId,
    metadata:   { provider: key.provider, label: key.label },
    ...requestContext(req),
  })

  return NextResponse.json({ ok: true })
}
