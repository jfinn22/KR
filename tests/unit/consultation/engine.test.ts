import { describe, expect, it } from 'vitest'
import { evaluate, rulesetHash } from '@/domain/consultation/engine'
import { getRuleset, DEFAULT_RULESET_VERSION } from '@/domain/consultation/registry'
import type { ConsultationFacts, Level } from '@/domain/consultation/facts'
import {
  BALAYAGE,
  DRY_CUT,
  ROOT_TOUCH_UP,
  TAPE_EXTENSIONS,
  TODAY,
  baseFacts,
  chem,
} from './fixtures'

const ruleset = getRuleset(DEFAULT_RULESET_VERSION)
const run = (facts: ConsultationFacts) => evaluate({ facts, ruleset, today: TODAY })

const codes = (facts: ConsultationFacts) => run(facts).flags.map((f) => f.code)

describe('a simple, healthy service', () => {
  const result = run(baseFacts())

  it('raises no flags', () => {
    expect(result.flags).toEqual([])
    expect(result.maxSeverity).toBe('NONE')
  })

  it('is bookable online, in one session, with no deposit', () => {
    expect(result.blocksOnlineBooking).toBe(false)
    expect(result.plan.sessionCount).toBe(1)
    expect(result.deposit.band).toBe(0)
    expect(result.deposit.amountCents).toBe(0)
  })

  it('is eligible for auto-approval but still recommends nothing more than that', () => {
    expect(result.recommendedDecision).toBe('AUTO_APPROVE_ELIGIBLE')
  })

  it('estimates a sensible duration from the phase chain', () => {
    expect(result.duration.totalMin).toBe(45)
  })
})

describe('every flag carries a recommended path', () => {
  // The product rule the whole design rests on: a flag that only refuses is a
  // flag stylists learn to click past.
  const scenarios: Record<string, ConsultationFacts> = {
    boxDye: baseFacts({
      request: { services: [BALAYAGE] },
      goal: { targetLevel: 9 as Level },
      hair: { currentLevel: { mids: 5 as Level } },
      history: [chem('BOX_DYE', 4)],
    }),
    henna: baseFacts({
      request: { services: [BALAYAGE] },
      history: [chem('HENNA', 8, { productKnown: false })],
    }),
    extensions: baseFacts({
      request: { services: [TAPE_EXTENSIONS] },
      hair: { elasticity: 'POOR', breakageReported: true },
    }),
    allergy: baseFacts({
      request: { services: [ROOT_TOUCH_UP] },
      health: { priorReactionToColor: true },
    }),
    relaxer: baseFacts({
      request: { services: [BALAYAGE] },
      goal: { targetLevel: 8 as Level },
      history: [chem('RELAXER', 3)],
    }),
    integrity: baseFacts({
      request: { services: [BALAYAGE] },
      hair: { gumminessReported: true, breakageReported: true },
    }),
    minor: baseFacts({ request: { services: [ROOT_TOUCH_UP] }, isMinor: true }),
    photos: baseFacts({ photos: { missingRequiredViews: ['BACK', 'ENDS'] } }),
  }

  it.each(Object.keys(scenarios))('%s scenario', (key) => {
    const result = run(scenarios[key]!)
    expect(result.flags.length).toBeGreaterThan(0)
    for (const flag of result.flags) {
      expect(flag.recommendedPath.length, `${flag.code} has no recommended path`).toBeGreaterThan(
        20,
      )
      expect(flag.evidence.length, `${flag.code} has no evidence`).toBeGreaterThan(0)
      expect(flag.clientExplanation.length).toBeGreaterThan(10)
    }
  })
})

describe('box dye with a high-lift goal', () => {
  const facts = baseFacts({
    request: { services: [BALAYAGE] },
    goal: { targetLevel: 9 as Level },
    hair: { currentLevel: { roots: 5 as Level, mids: 5 as Level, ends: 5 as Level } },
    history: [chem('BOX_DYE', 4)],
  })
  const result = run(facts)

  it('flags it as HIGH', () => {
    const flag = result.flags.find((f) => f.code === 'BOX_DYE_HIGH_LIFT')
    expect(flag?.severity).toBe('HIGH')
  })

  // A 4-level lift over box dye is two sessions; five or more becomes three.
  it('plans multiple sessions with real spacing', () => {
    expect(result.plan.sessionCount).toBe(2)
    expect(result.plan.sessions[1]!.minDaysAfterPrevious).toBe(42)
    expect(result.plan.sessions[1]!.maxDaysAfterPrevious).toBe(84)
    expect(result.plan.strategy).toBe('GRADUAL_LIFT')
  })

  it('escalates to three sessions when the lift is five levels or more', () => {
    const bigger = baseFacts({
      request: { services: [BALAYAGE] },
      goal: { targetLevel: 10 as Level },
      hair: { currentLevel: { roots: 5 as Level, mids: 5 as Level, ends: 5 as Level } },
      history: [chem('BOX_DYE', 4)],
    })
    expect(run(bigger).plan.sessionCount).toBe(3)
  })

  it('front-loads the first session rather than splitting evenly', () => {
    const [first, second] = result.plan.sessions
    expect(first!.estimatedPriceCents).toBeGreaterThan(second!.estimatedPriceCents)
  })

  it('requires a strand test', () => {
    expect(result.requirements.map((r) => r.kind)).toContain('STRAND_TEST')
  })

  it('raises the deposit to the highest band', () => {
    expect(result.deposit.band).toBe(3)
    expect(result.deposit.amountCents).toBeGreaterThan(0)
  })

  it('quotes a range rather than pretending to a single number', () => {
    expect(result.price.isRange).toBe(true)
    expect(result.price.highCents).toBeGreaterThan(result.price.lowCents)
  })

  it('does not fire when the box dye was only ever on the roots', () => {
    const rootsOnly = baseFacts({
      ...facts,
      history: [chem('BOX_DYE', 4, { appliedTo: ['ROOTS'] })],
    })
    expect(codes(rootsOnly)).not.toContain('BOX_DYE_HIGH_LIFT')
  })

  it('does not fire for a small lift', () => {
    const smallLift = baseFacts({ ...facts, goal: { targetLevel: 6 as Level } })
    expect(codes(smallLift)).not.toContain('BOX_DYE_HIGH_LIFT')
  })
})

describe('henna before a lightener', () => {
  const unknownProduct = baseFacts({
    request: { services: [BALAYAGE] },
    history: [chem('HENNA', 10, { productKnown: false })],
  })

  it('blocks online booking when the product is unknown', () => {
    const result = run(unknownProduct)
    const flag = result.flags.find((f) => f.code === 'HENNA_LIGHTENER_CONFLICT')
    expect(flag?.severity).toBe('BLOCKER')
    expect(result.blocksOnlineBooking).toBe(true)
    expect(result.recommendedDecision).toBe('DECLINE_ONLINE')
  })

  it('is HIGH but not blocking when the product is identified', () => {
    const known = baseFacts({
      request: { services: [BALAYAGE] },
      history: [chem('HENNA', 10, { productKnown: true })],
    })
    const result = run(known)
    const flag = result.flags.find((f) => f.code === 'HENNA_LIGHTENER_CONFLICT')
    expect(flag?.severity).toBe('HIGH')
    expect(result.blocksOnlineBooking).toBe(false)
  })

  it('still offers a route forward rather than a refusal', () => {
    const flag = run(unknownProduct).flags.find((f) => f.code === 'HENNA_LIGHTENER_CONFLICT')
    expect(flag!.recommendedPath).toMatch(/consult|test/i)
  })

  it('does not fire for a service with no lightener', () => {
    const cutOnly = baseFacts({ history: [chem('HENNA', 10, { productKnown: false })] })
    expect(codes(cutOnly)).not.toContain('HENNA_LIGHTENER_CONFLICT')
  })
})

describe('allergy and patch testing', () => {
  it('a prior reaction blocks online booking and demands a patch test', () => {
    const facts = baseFacts({
      request: { services: [ROOT_TOUCH_UP] },
      health: { priorReactionToColor: true },
    })
    const result = run(facts)
    expect(result.blocksOnlineBooking).toBe(true)
    expect(result.mode).toBe('IN_PERSON')
    expect(result.requirements.map((r) => r.kind)).toEqual(
      expect.arrayContaining(['PATCH_TEST', 'IN_PERSON_CONSULT', 'FORM_SIGNATURE']),
    )
  })

  it('a missing patch test is a CAUTION, not a blocker', () => {
    const facts = baseFacts({
      request: { services: [ROOT_TOUCH_UP] },
      compliance: { validPatchTestDaysRemaining: null },
    })
    const result = run(facts)
    const flag = result.flags.find((f) => f.code === 'PATCH_TEST_REQUIRED')
    expect(flag?.severity).toBe('CAUTION')
    expect(result.blocksOnlineBooking).toBe(false)
    expect(result.requirements.find((r) => r.kind === 'PATCH_TEST')?.leadHours).toBe(48)
  })

  it('an expired patch test counts as no patch test', () => {
    const facts = baseFacts({
      request: { services: [ROOT_TOUCH_UP] },
      compliance: { validPatchTestDaysRemaining: -3 },
    })
    expect(codes(facts)).toContain('PATCH_TEST_REQUIRED')
  })

  it('a valid patch test on healthy scalp raises nothing', () => {
    const facts = baseFacts({ request: { services: [ROOT_TOUCH_UP] } })
    expect(codes(facts)).not.toContain('PATCH_TEST_REQUIRED')
  })

  it('an active scalp condition escalates to HIGH even with a valid test', () => {
    const facts = baseFacts({
      request: { services: [ROOT_TOUCH_UP] },
      hair: { scalpCondition: 'PSORIASIS' },
    })
    const flag = run(facts).flags.find((f) => f.code === 'ACTIVE_SCALP_CONDITION')
    expect(flag?.severity).toBe('HIGH')
  })

  it('the allergy rule suppresses the generic patch-test rule rather than double-flagging', () => {
    const facts = baseFacts({
      request: { services: [ROOT_TOUCH_UP] },
      health: { knownAllergies: ['PPD'] },
      compliance: { validPatchTestDaysRemaining: null },
    })
    const found = codes(facts)
    expect(found).toContain('PRIOR_COLOUR_REACTION')
    expect(found).not.toContain('PATCH_TEST_REQUIRED')
  })
})

describe('extensions on fragile hair', () => {
  it('blocks when two or more integrity signals are present', () => {
    const facts = baseFacts({
      request: { services: [TAPE_EXTENSIONS] },
      hair: { elasticity: 'POOR', breakageReported: true, integrityScore: 3 },
    })
    const result = run(facts)
    expect(result.blocksOnlineBooking).toBe(true)
    expect(result.plan.sessionCount).toBe(2)
    expect(result.plan.strategy).toBe('REPAIR_PROGRAM')
  })

  it('is a caution, not a block, for a single mild signal', () => {
    const facts = baseFacts({
      request: { services: [TAPE_EXTENSIONS] },
      hair: { texture: 'FINE', density: 'LOW' },
    })
    const result = run(facts)
    const flag = result.flags.find((f) => f.code === 'EXTENSIONS_ON_FRAGILE_HAIR')
    expect(flag?.severity).toBe('CAUTION')
    expect(result.blocksOnlineBooking).toBe(false)
  })

  it('does not fire on healthy hair', () => {
    const facts = baseFacts({ request: { services: [TAPE_EXTENSIONS] } })
    expect(codes(facts)).not.toContain('EXTENSIONS_ON_FRAGILE_HAIR')
  })
})

describe('duration estimation', () => {
  it('scales with hair length but leaves processing time alone', () => {
    const short = run(
      baseFacts({ request: { services: [BALAYAGE] }, hair: { lengthCategory: 'CHIN' } }),
    )
    const long = run(
      baseFacts({ request: { services: [BALAYAGE] }, hair: { lengthCategory: 'WAIST' } }),
    )

    expect(long.duration.totalMin).toBeGreaterThan(short.duration.totalMin)

    // Processing is chemistry — 40 minutes is 40 minutes regardless of length.
    // The whole difference must therefore come from the scalable phases.
    const scalable = 90 + 45
    const maxPossible = Math.round(scalable * (1.4 - 0.9)) + 5
    expect(long.duration.totalMin - short.duration.totalMin).toBeLessThanOrEqual(maxPossible)
  })

  it('explains itself with a breakdown', () => {
    const result = run(
      baseFacts({ request: { services: [BALAYAGE] }, hair: { lengthCategory: 'WAIST' } }),
    )
    expect(result.duration.breakdown.some((b) => b.source === 'BASE')).toBe(true)
    expect(result.duration.breakdown.some((b) => b.source === 'MODIFIER')).toBe(true)
  })

  it('ignores stylist calibration below the sample threshold', () => {
    const few = run(
      baseFacts({
        request: { services: [BALAYAGE], stylistDurationFactor: 1.3, stylistCalibrationSamples: 2 },
      }),
    )
    const none = run(baseFacts({ request: { services: [BALAYAGE] } }))
    expect(few.duration.totalMin).toBe(none.duration.totalMin)
  })

  it('applies calibration once there are enough samples', () => {
    const calibrated = run(
      baseFacts({
        request: {
          services: [BALAYAGE],
          stylistDurationFactor: 1.3,
          stylistCalibrationSamples: 20,
        },
      }),
    )
    const baseline = run(baseFacts({ request: { services: [BALAYAGE] } }))
    expect(calibrated.duration.totalMin).toBeGreaterThan(baseline.duration.totalMin)
    expect(calibrated.duration.confidence).toBe('HIGH')
  })

  it('clamps an extreme calibration factor rather than trusting it', () => {
    const extreme = run(
      baseFacts({
        request: { services: [BALAYAGE], stylistDurationFactor: 5, stylistCalibrationSamples: 50 },
      }),
    )
    const baseline = run(baseFacts({ request: { services: [BALAYAGE] } }))
    expect(extreme.duration.totalMin).toBeLessThanOrEqual(
      Math.ceil(baseline.duration.totalMin * 1.35) + 5,
    )
  })

  it('reports low confidence when photos are missing', () => {
    const result = run(baseFacts({ photos: { missingRequiredViews: ['BACK'] } }))
    expect(result.duration.confidence).toBe('LOW')
  })
})

describe('deposit derivation', () => {
  it('scales with complexity and risk', () => {
    const simple = run(baseFacts())
    const complex = run(
      baseFacts({
        request: { services: [BALAYAGE] },
        goal: { targetLevel: 9 as Level },
        hair: { currentLevel: { mids: 5 as Level } },
        history: [chem('BOX_DYE', 3)],
      }),
    )
    expect(simple.deposit.band).toBe(0)
    expect(complex.deposit.band).toBe(3)
  })

  it('raises the deposit for a client with repeated no-shows', () => {
    const reliable = run(baseFacts({ request: { services: [BALAYAGE] } }))
    const risky = run(baseFacts({ request: { services: [BALAYAGE] }, priorNoShows: 3 }))
    expect(risky.deposit.band).toBeGreaterThan(reliable.deposit.band)
    expect(risky.deposit.rationale).toMatch(/missed appointments/i)
  })

  it('never exceeds the salon cap', () => {
    const result = evaluate({
      facts: baseFacts({
        request: { services: [TAPE_EXTENSIONS] },
        hair: { elasticity: 'POOR', breakageReported: true },
      }),
      ruleset,
      today: TODAY,
      depositPolicy: {
        bandPercentBps: [0, 2000, 3000, 5000],
        bandMinCents: [0, 2500, 5000, 10000],
        capCents: 7500,
      },
    })
    expect(result.deposit.amountCents).toBeLessThanOrEqual(7500)
  })

  it('explains which input set the band', () => {
    const result = run(baseFacts({ request: { services: [BALAYAGE] }, priorNoShows: 4 }))
    expect(result.deposit.rationale.length).toBeGreaterThan(10)
  })
})

describe('determinism and reproducibility', () => {
  const facts = baseFacts({
    request: { services: [BALAYAGE] },
    goal: { targetLevel: 9 as Level },
    history: [chem('BOX_DYE', 4)],
  })

  it('produces byte-identical output across repeated runs', () => {
    const a = JSON.stringify(run(facts))
    for (let i = 0; i < 25; i++) {
      expect(JSON.stringify(run(facts))).toBe(a)
    }
  })

  it('hashes the input so an evaluation can be tied to exact facts', () => {
    expect(run(facts).inputHash).toBe(run(facts).inputHash)
    expect(run(facts).inputHash).not.toBe(run(baseFacts()).inputHash)
  })

  it('input hash is independent of key ordering', () => {
    // Rebuild the whole structure with every object's keys reversed. The hash
    // must not care, or two identical consultations would look different.
    const reverseKeys = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(reverseKeys)
      if (v === null || typeof v !== 'object') return v
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v as object).reverse()) {
        out[k] = reverseKeys((v as Record<string, unknown>)[k])
      }
      return out
    }
    const reordered = reverseKeys(facts) as ConsultationFacts
    expect(run(reordered).inputHash).toBe(run(facts).inputHash)
  })

  it('the ruleset hash changes if any rule version is bumped', () => {
    const before = rulesetHash(ruleset)
    const bumped = {
      ...ruleset,
      rules: ruleset.rules.map((r, i) => (i === 0 ? { ...r, version: r.version + 1 } : r)),
    }
    expect(rulesetHash(bumped)).not.toBe(before)
  })

  it('rule order in the array cannot change the result', () => {
    const reversed = { ...ruleset, rules: [...ruleset.rules].reverse() }
    const forward = evaluate({ facts, ruleset, today: TODAY })
    const backward = evaluate({ facts, ruleset: reversed, today: TODAY })

    // The ruleset hash is order-independent too, so these are fully comparable.
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward))
  })

  it('does not read the system clock', () => {
    const a = evaluate({ facts, ruleset, today: '2026-01-01' })
    const b = evaluate({ facts, ruleset, today: '2027-12-31' })
    expect({ ...a, evaluatedAt: null }).toEqual({ ...b, evaluatedAt: null })
  })
})

describe('salon rule overrides', () => {
  const facts = baseFacts({
    request: { services: [BALAYAGE] },
    history: [chem('HENNA', 8, { productKnown: false })],
  })

  it('a disabled rule stops firing', () => {
    const withRule = run(facts)
    expect(withRule.blocksOnlineBooking).toBe(true)

    const without = evaluate({
      facts,
      ruleset,
      today: TODAY,
      disabledRuleIds: new Set(['HENNA_LIGHTENER_CONFLICT']),
    })
    expect(without.flags.map((f) => f.code)).not.toContain('HENNA_LIGHTENER_CONFLICT')
    expect(without.blocksOnlineBooking).toBe(false)
  })
})

describe('recommended decision', () => {
  it('never auto-approves anything carrying a real flag', () => {
    const flagged = run(
      baseFacts({ request: { services: [BALAYAGE] }, hair: { gumminessReported: true } }),
    )
    expect(flagged.recommendedDecision).not.toBe('AUTO_APPROVE_ELIGIBLE')
  })

  it('requires in person when a rule forces it', () => {
    const result = run(
      baseFacts({ request: { services: [BALAYAGE] }, history: [chem('RELAXER', 2)] }),
    )
    expect(result.recommendedDecision).toBe('DECLINE_ONLINE')
    expect(result.mode).toBe('IN_PERSON')
  })

  it('falls back to stylist review when photos are incomplete', () => {
    const result = run(baseFacts({ photos: { missingRequiredViews: ['ENDS'] } }))
    expect(result.recommendedDecision).toBe('STYLIST_REVIEW')
  })
})

describe('multiple rules firing together', () => {
  const facts = baseFacts({
    isNewToSalon: true,
    priorNoShows: 2,
    request: { services: [BALAYAGE, ROOT_TOUCH_UP] },
    goal: { targetLevel: 9 as Level, hardDeadlineDaysAway: 21 },
    hair: {
      currentLevel: { roots: 4 as Level, mids: 4 as Level, ends: 4 as Level },
      gumminessReported: true,
      scalpCondition: 'IRRITATED',
      greyPercent: 60,
      greyResistant: true,
      lengthCategory: 'MID_BACK',
    },
    history: [chem('BOX_DYE', 3), chem('KERATIN', 2)],
    lifestyle: { swimsChlorinatedWeekly: true, maintenanceAppetite: 'LOW' },
    compliance: { validPatchTestDaysRemaining: null },
  })
  const result = run(facts)

  it('surfaces every applicable flag rather than stopping at the first', () => {
    expect(result.flags.length).toBeGreaterThanOrEqual(6)
  })

  it('orders flags by severity, most serious first', () => {
    const ranks = result.flags.map(
      (f) => ({ BLOCKER: 3, HIGH: 2, CAUTION: 1, INFO: 0 })[f.severity],
    )
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a))
  })

  it('reaches the corrective complexity band', () => {
    expect(result.complexity.band).toBe('CORRECTIVE')
    expect(result.complexity.score).toBeGreaterThanOrEqual(70)
  })

  it('deduplicates overlapping requirements', () => {
    const strandTests = result.requirements.filter((r) => r.kind === 'STRAND_TEST')
    expect(strandTests.length).toBeLessThanOrEqual(1)
  })

  it('keeps the strictest due-before when rules disagree', () => {
    const patch = result.requirements.find((r) => r.kind === 'PATCH_TEST')
    expect(patch?.dueBefore).toBe('BOOKING')
  })

  it('takes the largest session count across all rules', () => {
    expect(result.plan.sessionCount).toBe(3)
  })
})
