// Unit tests for errorToMessage — the log serializer that avoids "[object Object]".
// All pure — no I/O.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { errorToMessage } from '../lib/logger.js'

describe('errorToMessage', () => {
  it('returns .message for Error instances', () => {
    assert.equal(errorToMessage(new Error('boom')), 'boom')
  })

  it('returns strings as-is', () => {
    assert.equal(errorToMessage('plain string'), 'plain string')
  })

  it('formats a Supabase PostgrestError object (message + code + details)', () => {
    const pgErr = { message: 'deadlock detected', code: '40P01', details: 'process 123 waits', hint: null }
    assert.equal(errorToMessage(pgErr), 'deadlock detected (40P01) — process 123 waits')
  })

  it('formats a plain object with only a message', () => {
    assert.equal(errorToMessage({ message: 'just a message' }), 'just a message')
  })

  it('JSON-stringifies an object with no message field (never "[object Object]")', () => {
    const result = errorToMessage({ foo: 'bar', n: 1 })
    assert.notEqual(result, '[object Object]')
    assert.equal(result, '{"foo":"bar","n":1}')
  })

  it('handles null and undefined', () => {
    assert.equal(errorToMessage(null), 'null')
    assert.equal(errorToMessage(undefined), 'undefined')
  })

  it('handles circular objects without throwing', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    // No message field → JSON.stringify throws on cycle → falls back to String()
    assert.doesNotThrow(() => errorToMessage(circular))
  })
})
