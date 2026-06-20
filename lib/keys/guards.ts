// Pure functions — no I/O, suitable for unit tests.

import type { ProviderKeyRow, MaskedProviderKey } from '@/types/database'

/**
 * Returns true when there is at most 1 active key for a provider.
 * Used to block disabling or deleting the last active key.
 */
export function isLastActiveKey(activeCount: number): boolean {
  return activeCount <= 1
}

/**
 * Convert a full DB row to the safe display shape.
 *
 * SECURITY: intentionally omits key_ciphertext, key_iv, key_auth_tag, and
 * created_by. These must never appear in API responses or logs.
 */
export function maskProviderKey(row: ProviderKeyRow): MaskedProviderKey {
  return {
    id:              row.id,
    created_at:      row.created_at,
    provider:        row.provider,
    label:           row.label,
    last4:           row.last4,
    status:          row.status,
    disabled_reason: row.disabled_reason,
    last_used_at:    row.last_used_at,
  }
}
