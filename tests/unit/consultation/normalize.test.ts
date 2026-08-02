import { describe, expect, it } from 'vitest'
import { normalizeFacts, type NormalizeInput } from '@/domain/consultation/normalize'
import {
  buildSteps,
  completionRatio,
  evaluateCondition,
  missingRequired,
  visibleQuestions,
} from '@/domain/consultation/visibility'
import { evaluate } from '@/domain/consultation/engine'
import { getRuleset } from '@/domain/consultation/registry'
import { BALAYAGE, ROOT_TOUCH_UP } from './fixtures'

const TODAY = new Date('2026-08-03T12:00:00Z')

function input(overrides: Partial<NormalizeInput> = {}): NormalizeInput {
  return {
    answers: {},
    factKeys: {},
    hairProfile: null,
    client: {
      ref: 'ref_1',
      isMinor: false,
      isNewToSalon: false,
      priorNoShows: 0,
      priorCompletedVisits: 4,
    },
    services: [BALAYAGE],
    stylist: { ref: 'sty_1', skills: { BALAYAGE: 5 }, durationFactor: 1, calibrationSamples: 0 },
    compliance: { validPatchTestDaysRemaining: 100, guardianConsentOnFile: false },
    photos: {
      providedViews: ['FRONT', 'BACK'],
      requiredViews: ['FRONT', 'BACK'],
      lowestQualityScore: 0.9,
    },
    today: TODAY,
    ...overrides,
  }
}

describe('conditional visibility', () => {
  const questions = [
    { key: 'box_dye', section: 'History', sortOrder: 0, isRequired: true },
    {
      key: 'box_dye_when',
      section: 'History',
      sortOrder: 1,
      isRequired: true,
      visibleWhenJson: { '==': [{ var: 'box_dye' }, true] },
    },
    { key: 'goal', section: 'Goal', sortOrder: 2, isRequired: true },
  ]

  it('hides a follow-up until its trigger is answered', () => {
    expect(visibleQuestions(questions, {}).map((q) => q.key)).toEqual(['box_dye', 'goal'])
  })

  it('reveals the follow-up once the trigger is yes', () => {
    expect(visibleQuestions(questions, { box_dye: true }).map((q) => q.key)).toEqual([
      'box_dye',
      'box_dye_when',
      'goal',
    ])
  })

  it('treats "true" and true the same — a select and a checkbox should behave alike', () => {
    expect(visibleQuestions(questions, { box_dye: 'true' })).toHaveLength(3)
  })

  it('supports and / or / not', () => {
    const answers = { a: 1, b: 'x' }
    expect(
      evaluateCondition(
        { and: [{ '==': [{ var: 'a' }, 1] }, { '==': [{ var: 'b' }, 'x'] }] },
        answers,
      ),
    ).toBe(true)
    expect(
      evaluateCondition(
        { and: [{ '==': [{ var: 'a' }, 2] }, { '==': [{ var: 'b' }, 'x'] }] },
        answers,
      ),
    ).toBe(false)
    expect(
      evaluateCondition(
        { or: [{ '==': [{ var: 'a' }, 2] }, { '==': [{ var: 'b' }, 'x'] }] },
        answers,
      ),
    ).toBe(true)
    expect(evaluateCondition({ not: { '==': [{ var: 'a' }, 1] } }, answers)).toBe(false)
  })

  it('supports comparison and membership', () => {
    expect(evaluateCondition({ '>': [{ var: 'n' }, 5] }, { n: 9 })).toBe(true)
    expect(evaluateCondition({ '<': [{ var: 'n' }, 5] }, { n: 9 })).toBe(false)
    expect(evaluateCondition({ in: [{ var: 's' }, ['a', 'b']] }, { s: 'b' })).toBe(true)
    expect(evaluateCondition({ answered: { var: 's' } }, { s: '' })).toBe(false)
  })

  // Failing open matters: a broken condition hiding "have you reacted to
  // colour before?" is far worse than one extra question on screen.
  it('shows the question when a condition is malformed', () => {
    expect(evaluateCondition({ '==': ['not-a-ref', 1] }, {})).toBe(true)
    expect(evaluateCondition({ nonsense: true }, {})).toBe(true)
    expect(evaluateCondition(undefined, {})).toBe(true)
  })

  it('groups into one section per screen', () => {
    const steps = buildSteps(questions, { box_dye: true })
    expect(steps.map((s) => s.section)).toEqual(['History', 'Goal'])
    expect(steps[0]!.questions).toHaveLength(2)
  })

  it('only requires questions that are actually visible', () => {
    expect(missingRequired(questions, {}).map((q) => q.key)).toEqual(['box_dye', 'goal'])
    expect(missingRequired(questions, { box_dye: true }).map((q) => q.key)).toEqual([
      'box_dye_when',
      'goal',
    ])
  })

  it('measures completion against visible questions, so branching does not skew it', () => {
    expect(completionRatio(questions, { box_dye: false, goal: 'blonde' })).toBe(1)
    expect(completionRatio(questions, { box_dye: true, goal: 'blonde' })).toBeCloseTo(2 / 3)
  })
})

describe('normalizing answers into facts', () => {
  it('maps answers onto fact paths', () => {
    const facts = normalizeFacts(
      input({
        answers: { q_goal: 9, q_natural: 4 },
        factKeys: { q_goal: 'goal.targetLevel', q_natural: 'hair.naturalLevel' },
      }),
    )
    expect(facts.goal.targetLevel).toBe(9)
    expect(facts.hair.naturalLevel).toBe(4)
  })

  // The client is in the room; the chart is not.
  it('a client answer overrides a stale profile value', () => {
    const facts = normalizeFacts(
      input({
        hairProfile: { naturalLevel: 3 },
        answers: { q: 7 },
        factKeys: { q: 'hair.naturalLevel' },
      }),
    )
    expect(facts.hair.naturalLevel).toBe(7)
  })

  it('falls back to the profile when a question was skipped', () => {
    const facts = normalizeFacts(input({ hairProfile: { naturalLevel: 3 } }))
    expect(facts.hair.naturalLevel).toBe(3)
  })

  it('clamps a level into range rather than trusting free input', () => {
    const facts = normalizeFacts(
      input({ answers: { q: 47 }, factKeys: { q: 'hair.naturalLevel' } }),
    )
    expect(facts.hair.naturalLevel).toBe(10)
  })

  it('coerces yes / true / 1 alike', () => {
    for (const value of [true, 'true', 'yes', 1, '1']) {
      const facts = normalizeFacts(
        input({ answers: { q: value }, factKeys: { q: 'hair.breakageReported' } }),
      )
      expect(facts.hair.breakageReported, String(value)).toBe(true)
    }
  })

  it('falls back to a safe default for an unrecognised enum', () => {
    const facts = normalizeFacts(
      input({ answers: { q: 'purple' }, factKeys: { q: 'hair.texture' } }),
    )
    expect(facts.hair.texture).toBe('MEDIUM')
  })
})

/*
 * A client picks "copper", not "level 6" — one choice that answers two facts.
 * Splitting it into two questions would be an artefact of our storage rather
 * than anything a client would recognise, so the shade answer lands on the
 * declared path and its sibling: hair.naturalLevel carries hair.naturalTone,
 * goal.targetLevel carries goal.targetTone.
 */
describe('a shade answers a depth and a tone together', () => {
  it('writes the depth to the declared path and the tone to its sibling', () => {
    const facts = normalizeFacts(
      input({
        answers: {
          q_goal: { level: 8, tone: 'BLONDE_GOLDEN_BLONDE' },
          q_natural: { level: 5, tone: 'NATURAL_LIGHT_BROWN' },
        },
        factKeys: { q_goal: 'goal.targetLevel', q_natural: 'hair.naturalLevel' },
      }),
    )

    expect(facts.goal.targetLevel).toBe(8)
    expect(facts.goal.targetTone).toBe('BLONDE_GOLDEN_BLONDE')
    expect(facts.hair.naturalLevel).toBe(5)
    expect(facts.hair.naturalTone).toBe('NATURAL_LIGHT_BROWN')
  })

  // Two vivids can need the same base, so the shade sets the depth, not vice versa.
  it('takes the depth from the shade when only a tone came through', () => {
    const facts = normalizeFacts(
      input({
        answers: { q: { tone: 'FASHION_PASTEL_PINK' } },
        factKeys: { q: 'goal.targetLevel' },
      }),
    )
    expect(facts.goal.targetLevel).toBe(10)
    expect(facts.goal.targetTone).toBe('FASHION_PASTEL_PINK')
  })

  /*
   * Consultations started before the picker had families stored a bare number.
   * Losing a half-finished consultation to a deploy would be a worse bug than
   * the one the families fixed.
   */
  it('still reads a bare level from before shades existed', () => {
    const facts = normalizeFacts(input({ answers: { q: 7 }, factKeys: { q: 'goal.targetLevel' } }))
    expect(facts.goal.targetLevel).toBe(7)
    expect(facts.goal.targetTone).toBeNull()
  })

  // A salon is free to point a question at a tone path with its own wording.
  it('keeps a tone it does not recognise rather than discarding the answer', () => {
    const facts = normalizeFacts(
      input({ answers: { q: 'warm caramel, no brass' }, factKeys: { q: 'goal.targetTone' } }),
    )
    expect(facts.goal.targetTone).toBe('warm caramel, no brass')
  })

  it('leaves the sibling alone for a path that is not a depth', () => {
    const facts = normalizeFacts(
      input({ answers: { q: 4 }, factKeys: { q: 'lifestyle.washesPerWeek' } }),
    )
    expect(facts.lifestyle.washesPerWeek).toBe(4)
    expect(facts.hair.naturalTone).toBeNull()
  })
})

describe('chemical history', () => {
  it('derives months-ago from a recorded date', () => {
    const facts = normalizeFacts(
      input({ hairProfile: { hasBoxDye: true, boxDyeLastAt: new Date('2026-04-05T00:00:00Z') } }),
    )
    const boxDye = facts.history.find((h) => h.kind === 'BOX_DYE')!
    expect(boxDye.monthsAgo).toBe(4)
    expect(boxDye.certainty).toBe('CONFIRMED')
  })

  // "Yes, but I can't remember when" is not the same as "no".
  it('records a reported event with no date as REPORTED, not absent', () => {
    const facts = normalizeFacts(
      input({ answers: { q: true }, factKeys: { q: 'history.boxDye.ever' } }),
    )
    const boxDye = facts.history.find((h) => h.kind === 'BOX_DYE')!
    expect(boxDye.monthsAgo).toBeNull()
    expect(boxDye.certainty).toBe('REPORTED')
  })

  it('omits a chemical the client says they never had', () => {
    const facts = normalizeFacts(
      input({
        hairProfile: { hasBoxDye: true },
        answers: { q: false },
        factKeys: { q: 'history.boxDye.ever' },
      }),
    )
    expect(facts.history.find((h) => h.kind === 'BOX_DYE')).toBeUndefined()
  })

  // For henna this distinction is the difference between caution and blocker.
  it('carries whether the henna product was identified', () => {
    const unknown = normalizeFacts(
      input({ hairProfile: { hasHenna: true, hennaProductKnown: false } }),
    )
    expect(unknown.history.find((h) => h.kind === 'HENNA')!.productKnown).toBe(false)

    const known = normalizeFacts(
      input({ hairProfile: { hasHenna: true, hennaProductKnown: true } }),
    )
    expect(known.history.find((h) => h.kind === 'HENNA')!.productKnown).toBe(true)
  })
})

describe('allergies and deadlines', () => {
  it('normalizes allergies from a list, a string, or a JSON column', () => {
    for (const value of [['ppd'], 'PPD, latex', { allergies: ['PPD'] }]) {
      const facts = normalizeFacts(input({ hairProfile: { allergiesJson: value } }))
      expect(facts.health.knownAllergies, JSON.stringify(value)).toContain('PPD')
    }
  })

  it('drops anything that is not a known allergen', () => {
    const facts = normalizeFacts(input({ hairProfile: { allergiesJson: ['peanuts', 'PPD'] } }))
    expect(facts.health.knownAllergies).toEqual(['PPD'])
  })

  it('accepts a deadline as a date or a day count', () => {
    const asDate = normalizeFacts(
      input({ answers: { q: '2026-08-24' }, factKeys: { q: 'goal.hardDeadlineDaysAway' } }),
    )
    expect(asDate.goal.hardDeadlineDaysAway).toBe(21)

    const asDays = normalizeFacts(
      input({ answers: { q: 21 }, factKeys: { q: 'goal.hardDeadlineDaysAway' } }),
    )
    expect(asDays.goal.hardDeadlineDaysAway).toBe(21)
  })
})

describe('photos', () => {
  it('reports which required views are missing', () => {
    const facts = normalizeFacts(
      input({
        photos: {
          providedViews: ['FRONT'],
          requiredViews: ['FRONT', 'BACK', 'ENDS'],
          lowestQualityScore: 0.8,
        },
      }),
    )
    expect(facts.photos.missingRequiredViews).toEqual(['BACK', 'ENDS'])
  })
})

describe('end to end into the rules engine', () => {
  const ruleset = getRuleset()

  // The bridge has to produce facts the engine actually reacts to, so this
  // asserts on the outcome rather than the intermediate shape.
  it('a client answering honestly about box dye triggers the staged-lift rule', () => {
    const facts = normalizeFacts(
      input({
        services: [BALAYAGE],
        hairProfile: {
          currentLevelMids: 5,
          hasBoxDye: true,
          boxDyeLastAt: new Date('2026-05-01T00:00:00Z'),
        },
        answers: { goal: 9 },
        factKeys: { goal: 'goal.targetLevel' },
      }),
    )

    const result = evaluate({ facts, ruleset, today: '2026-08-03' })
    expect(result.flags.map((f) => f.code)).toContain('BOX_DYE_HIGH_LIFT')
    expect(result.plan.sessionCount).toBeGreaterThan(1)
  })

  it('a client disclosing a prior reaction blocks online booking', () => {
    const facts = normalizeFacts(
      input({
        services: [ROOT_TOUCH_UP],
        answers: { reaction: true },
        factKeys: { reaction: 'health.priorReactionToColor' },
      }),
    )

    const result = evaluate({ facts, ruleset, today: '2026-08-03' })
    expect(result.blocksOnlineBooking).toBe(true)
    expect(result.mode).toBe('IN_PERSON')
  })

  it('a straightforward client sails through', () => {
    const facts = normalizeFacts(input({ services: [ROOT_TOUCH_UP] }))
    const result = evaluate({ facts, ruleset, today: '2026-08-03' })
    expect(result.blocksOnlineBooking).toBe(false)
    expect(result.flags).toEqual([])
  })
})
