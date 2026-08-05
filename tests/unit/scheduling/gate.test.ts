import { describe, expect, it } from 'vitest'
import { bookingGate, isBookable, needsOverride } from '@/domain/scheduling/gate'

/**
 * The consultation gate.
 *
 * The decision this file encodes is the one that makes staff booking possible
 * at all: a salon whose software turns a dry cut into a two-step process stops
 * using the software, and a salon whose software lets a bleach go in the diary
 * unseen should not be sold. Both failures are one line apart.
 */

const cut = {
  name: 'Dry cut',
  requiresConsultation: false,
  isChemical: false,
  isLightening: false,
  requiresPatchTest: false,
}
const tint = { ...cut, name: 'Root tint', isChemical: true, requiresPatchTest: true }
const balayage = { ...cut, name: 'Balayage', isChemical: true, isLightening: true }
const flagged = { ...cut, name: 'Extensions', requiresConsultation: true }

const clean = { hasApprovedPlan: false, hasValidPatchTest: true }

describe('what can just be booked', () => {
  it('a haircut, with nothing else in the way', () => {
    expect(bookingGate({ ...clean, services: [cut] })).toMatchObject({ decision: 'DIRECT' })
  })

  it('two harmless services together', () => {
    expect(bookingGate({ ...clean, services: [cut, { ...cut, name: 'Blow dry' }] })).toMatchObject({
      decision: 'DIRECT',
    })
  })

  it('nothing at all is refused rather than waved through', () => {
    expect(bookingGate({ ...clean, services: [] })).toMatchObject({ decision: 'REFUSED' })
  })
})

describe('what needs somebody to put their name to it', () => {
  it('a service the salon marked as needing a consultation', () => {
    const gate = bookingGate({ ...clean, services: [flagged] })
    expect(gate.decision).toBe('OVERRIDABLE')
    expect(gate.reason).toContain('Extensions')
  })

  it('lightening, even with the checkbox left unticked', () => {
    /*
     * A salon that adds a bleach service and forgets the checkbox has not
     * decided bleach is safe to book blind. It has forgotten.
     */
    const gate = bookingGate({ ...clean, services: [balayage] })
    expect(gate.decision).toBe('OVERRIDABLE')
    expect(gate.reason).toMatch(/lifts colour/i)
  })

  it('a chemical service, said plainly', () => {
    const gate = bookingGate({ ...clean, services: [tint] })
    expect(gate.decision).toBe('OVERRIDABLE')
    expect(gate.reason).toMatch(/chemical/i)
  })

  it('names every service that caused it, not just the first', () => {
    const gate = bookingGate({
      ...clean,
      services: [flagged, { ...flagged, name: 'Keratin' }],
    })
    expect(gate.reason).toContain('Extensions')
    expect(gate.reason).toContain('Keratin')
  })

  it('one risky service in a basket gates the whole basket', () => {
    expect(bookingGate({ ...clean, services: [cut, balayage] }).decision).toBe('OVERRIDABLE')
  })
})

describe('what an approved plan settles', () => {
  it('a plan is the consultation, so the gate stands down', () => {
    const gate = bookingGate({ ...clean, hasApprovedPlan: true, services: [balayage] })
    expect(gate.decision).toBe('PLAN')
    expect(needsOverride(gate)).toBe(false)
  })
})

describe('what nobody can sign their way past', () => {
  it('a missing patch test refuses outright', () => {
    const gate = bookingGate({ ...clean, hasValidPatchTest: false, services: [tint] })
    expect(gate.decision).toBe('REFUSED')
    expect(isBookable(gate)).toBe(false)
  })

  it('an approved plan does not revive an expired patch test', () => {
    /*
     * A plan approved in March does not make a patch test that expired in July
     * valid again. This is the one refusal that outranks a plan, because it is
     * about somebody's scalp rather than about paperwork.
     */
    const gate = bookingGate({
      services: [tint],
      hasApprovedPlan: true,
      hasValidPatchTest: false,
    })
    expect(gate.decision).toBe('REFUSED')
  })

  it('says what to do about it, not just that it is refused', () => {
    const gate = bookingGate({ ...clean, hasValidPatchTest: false, services: [tint] })
    expect(gate.reason).toMatch(/book the patch test first/i)
  })

  it('is not triggered by a service that does not need one', () => {
    expect(bookingGate({ ...clean, hasValidPatchTest: false, services: [cut] }).decision).toBe(
      'DIRECT',
    )
  })
})
