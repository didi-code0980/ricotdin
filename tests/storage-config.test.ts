// Unit tests for storage-config pure helpers (R2 admin config).
// All pure — no I/O, no live storage calls.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { maskStorageRow, r2ConfigFromEnv, STORAGE_SAFE_SELECT } from '../lib/storage/config.js'

describe('maskStorageRow', () => {
  const raw = {
    id: 'abc', created_at: 't1', updated_at: 't2', provider: 'r2', label: 'prod',
    account_id: 'acct123', access_key_id: 'AKID', bucket: 'recordings',
    secret_ciphertext: 'CIPHER', secret_iv: 'IV', secret_auth_tag: 'TAG', secret_last4: 'wxyz',
    status: 'active' as const, disabled_reason: null, last_used_at: null, created_by: 'user1',
  }

  it('never exposes ciphertext / iv / auth_tag / created_by', () => {
    const masked = maskStorageRow(raw)
    const json = JSON.stringify(masked)
    assert.ok(!json.includes('CIPHER'))
    assert.ok(!json.includes('IV'))
    assert.ok(!json.includes('TAG'))
    assert.ok(!('secret_ciphertext' in masked))
    assert.ok(!('secret_iv' in masked))
    assert.ok(!('secret_auth_tag' in masked))
    assert.ok(!('created_by' in masked))
  })

  it('keeps the safe display fields including last4', () => {
    const masked = maskStorageRow(raw)
    assert.equal(masked.label, 'prod')
    assert.equal(masked.bucket, 'recordings')
    assert.equal(masked.account_id, 'acct123')
    assert.equal(masked.access_key_id, 'AKID')
    assert.equal(masked.secret_last4, 'wxyz')
    assert.equal(masked.status, 'active')
  })

  it('STORAGE_SAFE_SELECT excludes the ciphertext columns', () => {
    assert.ok(!STORAGE_SAFE_SELECT.includes('ciphertext'))
    assert.ok(!STORAGE_SAFE_SELECT.includes('secret_iv'))
    assert.ok(!STORAGE_SAFE_SELECT.includes('auth_tag'))
    assert.ok(STORAGE_SAFE_SELECT.includes('secret_last4'))
    assert.ok(STORAGE_SAFE_SELECT.includes('bucket'))
  })
})

describe('r2ConfigFromEnv', () => {
  const full = {
    R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'akid',
    R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'bkt',
  } as unknown as NodeJS.ProcessEnv

  it('returns a config with source=env when all vars present', () => {
    const cfg = r2ConfigFromEnv(full)
    assert.ok(cfg)
    assert.equal(cfg!.accountId, 'acct')
    assert.equal(cfg!.accessKeyId, 'akid')
    assert.equal(cfg!.secretAccessKey, 'secret')
    assert.equal(cfg!.bucket, 'bkt')
    assert.equal(cfg!.source, 'env')
  })

  it('returns null when any required var is missing', () => {
    for (const drop of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
      const env = { ...full } as Record<string, string>
      delete env[drop]
      assert.equal(r2ConfigFromEnv(env as NodeJS.ProcessEnv), null, `missing ${drop} → null`)
    }
  })

  it('trims whitespace and treats blank as missing', () => {
    const env = { ...full, R2_BUCKET: '   ' } as unknown as NodeJS.ProcessEnv
    assert.equal(r2ConfigFromEnv(env), null)
  })
})
