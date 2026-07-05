// Unit tests for the AI provider registry (AIP-01).
// All pure — no I/O, no live provider calls.
// Run with: npm test

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveModel, getDefaultGenerationModel } from '../lib/ai/registry.js'

describe('resolveModel', () => {
  it('resolves gemini + gemini-2.5-flash to a valid entry', () => {
    const entry = resolveModel('gemini', 'gemini-2.5-flash')
    assert.equal(entry.provider, 'gemini')
    assert.equal(entry.model, 'gemini-2.5-flash')
    assert.ok(entry.adapter, 'adapter must be present')
    assert.equal(typeof entry.adapter.generateStructured, 'function')
    assert.equal(typeof entry.adapter.generateText, 'function')
  })

  it('resolves openai + gpt-4o to a valid entry (AIP-02)', () => {
    const entry = resolveModel('openai', 'gpt-4o')
    assert.equal(entry.provider, 'openai')
    assert.equal(entry.model, 'gpt-4o')
    assert.ok(entry.adapter, 'adapter must be present')
    assert.equal(typeof entry.adapter.generateStructured, 'function')
    assert.equal(typeof entry.adapter.generateText, 'function')
  })

  it('resolves openai + gpt-4o-mini to a valid entry (AIP-02)', () => {
    const entry = resolveModel('openai', 'gpt-4o-mini')
    assert.equal(entry.provider, 'openai')
    assert.equal(entry.model, 'gpt-4o-mini')
    assert.equal(entry.capabilities.hardJsonSchema, true)
    assert.equal(entry.capabilities.acceptsAudio,   false)
  })

  it('throws a clear error for an unknown provider', () => {
    assert.throws(
      () => resolveModel('anthropic', 'claude-opus'),
      /Unknown provider\/model/,
    )
  })

  it('throws a clear error for a known provider with an unknown model', () => {
    assert.throws(
      () => resolveModel('openai', 'gpt-3.5-turbo'),
      /Unknown provider\/model/,
    )
  })

  it('throws a clear error for gemini with an unknown model', () => {
    assert.throws(
      () => resolveModel('gemini', 'gpt-4o'),
      /Unknown provider\/model/,
    )
  })

  it('error message includes all registered models', () => {
    try {
      resolveModel('x-provider', 'unknown-model')
      assert.fail('should have thrown')
    } catch (err) {
      assert.ok(err instanceof Error)
      assert.ok(err.message.includes('gemini:gemini-2.5-flash'), 'error lists gemini model')
      assert.ok(err.message.includes('openai:gpt-4o'), 'error lists openai models (AIP-02)')
    }
  })
})

describe('getDefaultGenerationModel', () => {
  it('returns the gemini entry', () => {
    const entry = getDefaultGenerationModel()
    assert.equal(entry.provider, 'gemini')
    assert.equal(entry.model, 'gemini-2.5-flash')
  })

  it('returned adapter has the required interface methods', () => {
    const { adapter } = getDefaultGenerationModel()
    assert.equal(typeof adapter.generateStructured, 'function')
    assert.equal(typeof adapter.generateText, 'function')
  })

  it('gemini capability flags are correct for AIP-01', () => {
    const { capabilities } = getDefaultGenerationModel()
    assert.equal(capabilities.hardJsonSchema, true,  'Gemini enforces JSON schema natively')
    assert.equal(capabilities.acceptsAudio,   false, 'audio goes via Speechmatics, not this adapter')
    assert.ok(capabilities.maxContextTokens > 0, 'maxContextTokens must be positive')
  })
})
