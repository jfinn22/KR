/**
 * May this be booked without a consultation?
 *
 * The client portal never had to ask: every route into it starts with a
 * consultation, so an approved plan is a precondition of reaching the slot
 * picker at all. A front desk has no such funnel. Somebody rings up, asks for
 * a trim on Thursday, and the desk needs an answer — and "always require a
 * consultation" is not that answer, because a salon whose software makes a dry
 * cut into a two-step process stops using the software.
 *
 * So the rule, decided once, here, in words:
 *
 *   Not chemical, and not marked as needing one   book it.
 *   Anything else                                 an approved plan, or a
 *                                                 named person taking
 *                                                 responsibility in writing.
 *
 * Two things this deliberately does NOT do.
 *
 * It does not treat a patch test as paperwork. A missing patch test is an
 * allergy risk rather than an unfilled form, and no amount of front-desk
 * seniority makes somebody's scalp safer — so that case refuses outright and
 * the override does not reach it.
 *
 * And it never decides on its own that a chemical service is fine. The most a
 * clean basket earns is `DIRECT`; the most a risky one earns is a route
 * through a person, recorded.
 */

export interface GateService {
  name: string
  requiresConsultation: boolean
  isChemical: boolean
  isLightening: boolean
  requiresPatchTest: boolean
}

export interface GateInput {
  services: readonly GateService[]
  /** An approved, unexpired plan covering this basket. */
  hasApprovedPlan: boolean
  /** A negative patch test still inside its validity window. */
  hasValidPatchTest: boolean
}

export type GateDecision =
  /** Nothing in the way. Book it. */
  | { decision: 'DIRECT'; reason: null }
  /** A plan already says yes. */
  | { decision: 'PLAN'; reason: null }
  /** Bookable only by somebody who will put their name to it. */
  | { decision: 'OVERRIDABLE'; reason: string }
  /** Not bookable by anyone until something real changes. */
  | { decision: 'REFUSED'; reason: string }

export function bookingGate(input: GateInput): GateDecision {
  if (input.services.length === 0) {
    return { decision: 'REFUSED', reason: 'Pick at least one service.' }
  }

  /*
   * The patch test first, because it outranks everything else including an
   * approved plan. A plan approved in March does not make a patch test that
   * expired in July valid again, and this is the one refusal a manager cannot
   * sign their way past.
   */
  const needsPatchTest = input.services.filter((s) => s.requiresPatchTest)
  if (needsPatchTest.length > 0 && !input.hasValidPatchTest) {
    return {
      decision: 'REFUSED',
      reason:
        `${listNames(needsPatchTest)} needs a patch test on file, read as clear, ` +
        `and still in date. Book the patch test first.`,
    }
  }

  if (input.hasApprovedPlan) return { decision: 'PLAN', reason: null }

  const flagged = input.services.filter((s) => s.requiresConsultation)
  if (flagged.length > 0) {
    return {
      decision: 'OVERRIDABLE',
      reason: `${listNames(flagged)} is set up to need a consultation first.`,
    }
  }

  /*
   * Chemistry gates itself even when nobody ticked the box. A salon that adds
   * a bleach service and forgets the checkbox has not decided that bleach is
   * safe to book blind — it has forgotten, and the software should not read a
   * forgotten checkbox as consent.
   */
  const lightening = input.services.filter((s) => s.isLightening)
  if (lightening.length > 0) {
    return {
      decision: 'OVERRIDABLE',
      reason: `${listNames(lightening)} lifts colour, which is not something to book unseen.`,
    }
  }

  const chemical = input.services.filter((s) => s.isChemical)
  if (chemical.length > 0) {
    return {
      decision: 'OVERRIDABLE',
      reason: `${listNames(chemical)} is a chemical service.`,
    }
  }

  return { decision: 'DIRECT', reason: null }
}

/**
 * Whether this decision lets a booking through at all, with or without a name
 * on it.
 *
 * A type guard rather than a plain boolean, so the refusing branch narrows to
 * the variant that actually carries a reason — otherwise every caller has to
 * cope with a `reason` that is only null on the decisions it is not handling,
 * and reaches for the string comparison instead.
 */
export function isBookable(
  gate: GateDecision,
): gate is Exclude<GateDecision, { decision: 'REFUSED' }> {
  return gate.decision !== 'REFUSED'
}

/** Whether somebody has to hold the override action and give a reason. */
export function needsOverride(
  gate: GateDecision,
): gate is Extract<GateDecision, { decision: 'OVERRIDABLE' }> {
  return gate.decision === 'OVERRIDABLE'
}

function listNames(services: readonly GateService[]): string {
  const names = services.map((s) => s.name)
  if (names.length === 1) return names[0]!
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
