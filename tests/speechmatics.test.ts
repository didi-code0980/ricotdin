// Unit tests for lib/speechmatics/transcribe.ts — pure parsing functions only.
// No network calls, no file I/O. Run with: npm test

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseTranscriptResponse, formatSpeakerLabel } from '../lib/speechmatics/transcribe.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal well-formed Speechmatics json-v2 transcript with two speakers */
const TWO_SPEAKER_TRANSCRIPT = {
  metadata: {
    transcription_config: { language: 'en', diarization: 'speaker' },
  },
  results: [
    { type: 'word', start_time: 0.16, end_time: 0.48, speaker: 'S1', alternatives: [{ content: 'Hello', confidence: 0.99, language: 'en' }] },
    { type: 'word', start_time: 0.52, end_time: 0.92, speaker: 'S1', alternatives: [{ content: 'everyone', confidence: 0.97, language: 'en' }] },
    { type: 'punctuation', attaches_to: 'previous', alternatives: [{ content: '.' }] },
    { type: 'word', start_time: 1.20, end_time: 1.60, speaker: 'S2', alternatives: [{ content: 'Hi', confidence: 0.98, language: 'en' }] },
    { type: 'word', start_time: 1.64, end_time: 2.10, speaker: 'S2', alternatives: [{ content: 'there', confidence: 0.96, language: 'en' }] },
    { type: 'punctuation', attaches_to: 'previous', alternatives: [{ content: ',' }] },
    { type: 'word', start_time: 2.20, end_time: 2.60, speaker: 'S2', alternatives: [{ content: 'thanks', confidence: 0.95, language: 'en' }] },
  ],
  speakers: [
    { name: 'S1', duration: '0.76', confidence: null },
    { name: 'S2', duration: '1.76', confidence: null },
  ],
}

// ---------------------------------------------------------------------------
// formatSpeakerLabel
// ---------------------------------------------------------------------------

describe('formatSpeakerLabel', () => {
  it('maps S1 → Speaker 1', () => {
    assert.equal(formatSpeakerLabel('S1'), 'Speaker 1')
  })

  it('maps S12 → Speaker 12', () => {
    assert.equal(formatSpeakerLabel('S12'), 'Speaker 12')
  })

  it('maps UU (unknown speaker) → Speaker', () => {
    assert.equal(formatSpeakerLabel('UU'), 'Speaker')
  })

  it('passes through unrecognised labels unchanged', () => {
    assert.equal(formatSpeakerLabel('NARRATOR'), 'NARRATOR')
  })
})

// ---------------------------------------------------------------------------
// parseTranscriptResponse — segments
// ---------------------------------------------------------------------------

describe('parseTranscriptResponse — segments', () => {
  it('produces one segment per speaker turn', () => {
    const result = parseTranscriptResponse(TWO_SPEAKER_TRANSCRIPT)
    assert.equal(result.segments.length, 2)
  })

  it('first segment belongs to Speaker 1', () => {
    const result = parseTranscriptResponse(TWO_SPEAKER_TRANSCRIPT)
    assert.equal(result.segments[0].speaker, 'Speaker 1')
  })

  it('second segment belongs to Speaker 2', () => {
    const result = parseTranscriptResponse(TWO_SPEAKER_TRANSCRIPT)
    assert.equal(result.segments[1].speaker, 'Speaker 2')
  })

  it('joins words within a turn with spaces', () => {
    const result = parseTranscriptResponse(TWO_SPEAKER_TRANSCRIPT)
    assert.equal(result.segments[0].text, 'Hello everyone.')
    assert.equal(result.segments[1].text, 'Hi there, thanks')
  })

  it('converts start_time seconds → start_ms milliseconds correctly', () => {
    const result = parseTranscriptResponse(TWO_SPEAKER_TRANSCRIPT)
    assert.equal(result.segments[0].start_ms, 160)   // 0.16 * 1000
    assert.equal(result.segments[1].start_ms, 1200)  // 1.20 * 1000
  })

  it('converts end_time seconds → end_ms milliseconds correctly', () => {
    const result = parseTranscriptResponse(TWO_SPEAKER_TRANSCRIPT)
    assert.equal(result.segments[0].end_ms, 920)   // 0.92 * 1000
    assert.equal(result.segments[1].end_ms, 2600)  // 2.60 * 1000
  })

  it('returns empty segments for empty results', () => {
    const result = parseTranscriptResponse({ metadata: {}, results: [] })
    assert.deepEqual(result.segments, [])
  })

  it('handles results with no word tokens (punctuation only)', () => {
    const input = {
      results: [
        { type: 'punctuation', attaches_to: 'previous', alternatives: [{ content: '.' }] },
      ],
    }
    const result = parseTranscriptResponse(input)
    assert.deepEqual(result.segments, [])
  })
})

// ---------------------------------------------------------------------------
// parseTranscriptResponse — language detection
// ---------------------------------------------------------------------------

describe('parseTranscriptResponse — language detection', () => {
  it('detects language from first word alternative', () => {
    const result = parseTranscriptResponse(TWO_SPEAKER_TRANSCRIPT)
    assert.equal(result.language, 'en')
  })

  it('falls back to metadata.transcription_config.language when no word language', () => {
    const input = {
      metadata: { transcription_config: { language: 'vi' } },
      results: [
        { type: 'word', start_time: 0, end_time: 1, speaker: 'S1', alternatives: [{ content: 'Xin' }] },
      ],
    }
    const result = parseTranscriptResponse(input)
    assert.equal(result.language, 'vi')
  })

  it('falls back to "unknown" when no language available anywhere', () => {
    const result = parseTranscriptResponse({ results: [] })
    assert.equal(result.language, 'unknown')
  })
})

// ---------------------------------------------------------------------------
// parseTranscriptResponse — speaker edge cases
// ---------------------------------------------------------------------------

describe('parseTranscriptResponse — speaker edge cases', () => {
  it('maps UU (unknown speaker) to "Speaker"', () => {
    const input = {
      results: [
        { type: 'word', start_time: 0, end_time: 1, speaker: 'UU', alternatives: [{ content: 'Testing' }] },
      ],
    }
    const result = parseTranscriptResponse(input)
    assert.equal(result.segments[0].speaker, 'Speaker')
  })

  it('keeps same-speaker words in one segment', () => {
    const input = {
      results: [
        { type: 'word', start_time: 0, end_time: 0.5, speaker: 'S1', alternatives: [{ content: 'A' }] },
        { type: 'word', start_time: 0.6, end_time: 1.0, speaker: 'S1', alternatives: [{ content: 'B' }] },
        { type: 'word', start_time: 1.1, end_time: 1.5, speaker: 'S1', alternatives: [{ content: 'C' }] },
      ],
    }
    const result = parseTranscriptResponse(input)
    assert.equal(result.segments.length, 1)
    assert.equal(result.segments[0].text, 'A B C')
    assert.equal(result.segments[0].start_ms, 0)
    assert.equal(result.segments[0].end_ms, 1500)
  })

  it('splits into multiple segments on speaker change', () => {
    const input = {
      results: [
        { type: 'word', start_time: 0.0, end_time: 0.5, speaker: 'S1', alternatives: [{ content: 'One' }] },
        { type: 'word', start_time: 0.6, end_time: 1.0, speaker: 'S2', alternatives: [{ content: 'Two' }] },
        { type: 'word', start_time: 1.1, end_time: 1.5, speaker: 'S1', alternatives: [{ content: 'Three' }] },
      ],
    }
    const result = parseTranscriptResponse(input)
    assert.equal(result.segments.length, 3)
    assert.equal(result.segments[0].text, 'One')
    assert.equal(result.segments[1].text, 'Two')
    assert.equal(result.segments[2].text, 'Three')
  })

  it('handles missing speaker field by defaulting to S1', () => {
    const input = {
      results: [
        { type: 'word', start_time: 0, end_time: 1, alternatives: [{ content: 'Hello' }] },
      ],
    }
    const result = parseTranscriptResponse(input)
    assert.equal(result.segments.length, 1)
    assert.equal(result.segments[0].speaker, 'Speaker 1')
  })
})

// ---------------------------------------------------------------------------
// parseTranscriptResponse — punctuation handling
// ---------------------------------------------------------------------------

describe('parseTranscriptResponse — punctuation', () => {
  it('attaches punctuation to preceding word without space', () => {
    const input = {
      results: [
        { type: 'word', start_time: 0, end_time: 1, speaker: 'S1', alternatives: [{ content: 'Hello' }] },
        { type: 'punctuation', attaches_to: 'previous', alternatives: [{ content: ',' }] },
        { type: 'word', start_time: 1.1, end_time: 1.5, speaker: 'S1', alternatives: [{ content: 'world' }] },
        { type: 'punctuation', attaches_to: 'previous', alternatives: [{ content: '!' }] },
      ],
    }
    const result = parseTranscriptResponse(input)
    assert.equal(result.segments[0].text, 'Hello, world!')
  })

  it('ignores punctuation when there are no preceding words', () => {
    const input = {
      results: [
        { type: 'punctuation', attaches_to: 'previous', alternatives: [{ content: '.' }] },
        { type: 'word', start_time: 0, end_time: 1, speaker: 'S1', alternatives: [{ content: 'OK' }] },
      ],
    }
    const result = parseTranscriptResponse(input)
    // Orphan punctuation is dropped; only "OK" appears
    assert.equal(result.segments[0].text, 'OK')
  })

  it('punctuation at a speaker boundary attaches to the outgoing segment', () => {
    const input = {
      results: [
        { type: 'word', start_time: 0, end_time: 1, speaker: 'S1', alternatives: [{ content: 'Yes' }] },
        { type: 'punctuation', attaches_to: 'previous', alternatives: [{ content: '.' }] },
        { type: 'word', start_time: 1.2, end_time: 2, speaker: 'S2', alternatives: [{ content: 'No' }] },
      ],
    }
    const result = parseTranscriptResponse(input)
    assert.equal(result.segments[0].text, 'Yes.')
    assert.equal(result.segments[1].text, 'No')
  })
})
