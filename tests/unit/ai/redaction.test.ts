import { describe, expect, it } from 'vitest'
import { redactForAi } from '@/domain/ai/redaction'
import { assertRedacted } from '@/ports/ai'

/**
 * A leak of client PII to a third-party model is not something to find out
 * about from a client. Two layers guard it — the service redacts and the port
 * asserts — and these tests hold both, including the case where the service is
 * bypassed entirely.
 */

describe('redacting before the model sees it', () => {
  it('strips direct identifiers at the top level', () => {
    const result = redactForAi({
      firstName: 'Ada',
      lastName: 'Rivera',
      email: 'ada@example.com',
      phone: '+15551234567',
      dateOfBirth: '1990-01-01',
      naturalLevel: 5,
    })

    expect(result).toEqual({ naturalLevel: 5 })
  })

  // The dangerous case: a name buried three levels down in a joined row.
  it('strips them at any depth', () => {
    const result = redactForAi({
      consultation: {
        client: { firstName: 'Ada', email: 'ada@example.com', noShowCount: 1 },
        answers: [{ key: 'goal', value: 9 }],
      },
    })

    expect(JSON.stringify(result)).not.toContain('Ada')
    expect(JSON.stringify(result)).not.toContain('example.com')
    expect(JSON.stringify(result)).toContain('noShowCount')
  })

  it('strips them inside arrays', () => {
    const result = redactForAi({
      visits: [
        { name: 'Ada Rivera', service: 'Balayage' },
        { name: 'Tomas Vance', service: 'Gloss' },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('Rivera')
    expect(JSON.stringify(result)).toContain('Balayage')
  })

  it('keeps everything the model actually needs', () => {
    const input = {
      naturalLevel: 5,
      targetLevel: 9,
      history: [{ kind: 'BOX_DYE', monthsAgo: 4 }],
      porosity: 'HIGH',
      flags: [{ code: 'BOX_DYE_HIGH_LIFT', severity: 'CAUTION' }],
    }
    expect(redactForAi(input)).toEqual(input)
  })

  it('leaves dates alone rather than shredding them into objects', () => {
    const at = new Date('2026-08-02T10:00:00Z')
    const result = redactForAi({ occurredAt: at, level: 6 })
    expect(result.occurredAt).toBeInstanceOf(Date)
  })

  it('handles null, empty and primitive values without throwing', () => {
    expect(redactForAi({ a: null, b: undefined, c: 0, d: '', e: false })).toEqual({
      a: null,
      b: undefined,
      c: 0,
      d: '',
      e: false,
    })
    expect(redactForAi({})).toEqual({})
  })
})

describe('the port refuses what the service missed', () => {
  it('rejects an email address in a field nobody thought to strip', () => {
    expect(() => assertRedacted('ai', { note: 'call her on ada@example.com' })).toThrow(/email/i)
  })

  it('rejects a phone number', () => {
    expect(() => assertRedacted('ai', { note: 'ring +1 555 123 4567' })).toThrow(/phone/i)
  })

  it('allows hair data through', () => {
    expect(() =>
      assertRedacted('ai', { naturalLevel: 5, targetLevel: 9, monthsAgo: 4 }),
    ).not.toThrow()
  })

  // Belt and braces: the service's output must always satisfy the port.
  it('never trips on something the service already redacted', () => {
    const redacted = redactForAi({
      firstName: 'Ada',
      email: 'ada@example.com',
      phone: '+15551234567',
      naturalLevel: 5,
    })
    expect(() => assertRedacted('ai', redacted)).not.toThrow()
  })
})
