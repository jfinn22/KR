import type { ConsultationFacts } from './facts'
import { hashOf } from './hash'
import {
  SEVERITY_RANK,
  type ConsultationMode,
  type DepositBand,
  type DurationAdjustment,
  type DurationBreakdownEntry,
  type EvaluationResult,
  type PlannedSession,
  type RecommendedDecision,
  type ResolvedRequirement,
  type ResolvedRiskFlag,
  type Rule,
  type RuleContext,
  type RuleOutcome,
  type Ruleset,
  type SessionPlanDirective,
  type Severity,
} from './types'

/**
 * The consultation rules engine.
 *
 * A pure function of a frozen fact snapshot. No database, no clock, no
 * randomness, no network. Given the same facts and the same ruleset it returns
 * byte-identical output forever, which is what makes a stylist's approval
 * auditable a year later.
 *
 * Rule outcomes are combined by COMMUTATIVE reducers — flags collected then
 * sorted deterministically, complexity summed, duration additions summed before
 * multipliers applied in ruleId order, deposit band taken as a maximum. So the
 * order rules appear in the array cannot change the result, and adding a rule
 * can never alter another rule's behaviour.
 */

export interface EvaluateOptions {
  facts: ConsultationFacts
  ruleset: Ruleset
  /** Injected — the engine never reads the system clock. */
  today: string
  /** Rules the salon has switched off. */
  disabledRuleIds?: ReadonlySet<string>
  /** Deposit policy resolution, supplied as data to keep the engine pure. */
  depositPolicy?: DepositPolicyInput
}

export interface DepositPolicyInput {
  /** Percentage in basis points per band. */
  bandPercentBps: readonly [number, number, number, number]
  bandMinCents: readonly [number, number, number, number]
  capCents: number
}

const DEFAULT_DEPOSIT_POLICY: DepositPolicyInput = {
  bandPercentBps: [0, 2000, 3000, 5000],
  bandMinCents: [0, 2500, 5000, 10000],
  capCents: 50_000,
}

export function rulesetHash(ruleset: Ruleset): string {
  return hashOf({
    version: ruleset.version,
    rules: [...ruleset.rules]
      .map((r) => ({ id: r.id, version: r.version }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    settings: ruleset.settings,
  })
}

export function evaluate(opts: EvaluateOptions): EvaluationResult {
  const { facts, ruleset, today } = opts
  const disabled = opts.disabledRuleIds ?? new Set<string>()
  const ctx: RuleContext = { facts, today, settings: ruleset.settings }

  // --- 1. Run every rule. No short-circuiting: a BLOCKER must not hide the
  //        CAUTION flags a stylist still needs to see.
  const fired: { rule: Rule; outcome: RuleOutcome }[] = []
  for (const rule of ruleset.rules) {
    if (disabled.has(rule.id)) continue
    if (rule.appliesWhen && !rule.appliesWhen(ctx)) continue
    const outcome = rule.evaluate(ctx)
    if (outcome) fired.push({ rule, outcome })
  }

  // --- 2. Flags, deterministically ordered.
  const flags: ResolvedRiskFlag[] = fired
    .filter((f) => f.outcome.flag)
    .map(({ rule, outcome }) => {
      const flag = outcome.flag!
      return {
        ruleId: rule.id,
        ruleVersion: rule.version,
        code: flag.code,
        severity: flag.severity,
        category: rule.category,
        title: flag.title,
        detail: flag.detail,
        evidence: flag.evidence,
        recommendedPath: flag.recommendedPath,
        blocksOnlineBooking: flag.blocksOnlineBooking ?? false,
        clientExplanation: rule.docs.clientExplanation,
      }
    })
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
      return bySeverity !== 0 ? bySeverity : a.ruleId < b.ruleId ? -1 : 1
    })

  const maxSeverity: Severity | 'NONE' = flags.length
    ? flags.reduce<Severity>(
        (acc, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[acc] ? f.severity : acc),
        'INFO',
      )
    : 'NONE'

  const blocksOnlineBooking = flags.some((f) => f.blocksOnlineBooking)

  // --- 3. Complexity.
  const complexityBreakdown = [
    ...facts.request.services.map((s) => ({
      source: `service:${s.serviceId}`,
      delta: s.baseComplexity,
      reason: `${s.name} base complexity`,
    })),
    ...fired
      .filter((f) => f.outcome.complexity)
      .map((f) => ({
        source: `rule:${f.rule.id}`,
        delta: f.outcome.complexity!.delta,
        reason: f.outcome.complexity!.reason,
      })),
  ].sort((a, b) => (a.source < b.source ? -1 : 1))

  const complexityScore = clamp(
    complexityBreakdown.reduce((sum, c) => sum + c.delta, 0),
    0,
    100,
  )

  // --- 4. Duration.
  const duration = computeDuration(facts, fired, ruleset)

  // --- 5. Price.
  const basePrice = facts.request.services.reduce((sum, s) => sum + s.basePriceCents, 0)
  const priceAdds = fired
    .flatMap((f) => f.outcome.price ?? [])
    .filter((p) => p.op === 'ADD_CENTS')
    .reduce((sum, p) => sum + p.value, 0)
  const priceMultiplier = fired
    .flatMap((f) => f.outcome.price ?? [])
    .filter((p) => p.op === 'MULTIPLY')
    .reduce((acc, p) => acc * p.value, 1)
  const estimatedTotalCents = Math.round((basePrice + priceAdds) * priceMultiplier)

  // A quoted range widens with complexity — an honest quote for a correction is
  // a range, and pretending otherwise is how salons underprice. A HIGH or
  // BLOCKER flag also forces a range regardless of score: if we have told the
  // client the service is risky, quoting a single confident number contradicts
  // that in the same breath.
  const spreadBps = complexityScore >= 70 ? 3500 : complexityScore >= 40 ? 2000 : 800
  const riskyEnoughForRange =
    maxSeverity === 'HIGH' || maxSeverity === 'BLOCKER' || complexityScore >= 40
  const price = {
    estimatedTotalCents,
    isRange: riskyEnoughForRange,
    lowCents: estimatedTotalCents,
    highCents: Math.round(estimatedTotalCents * (1 + spreadBps / 10_000)),
  }

  // --- 6. Requirements, deduped.
  const requirements = dedupeRequirements(fired.flatMap((f) => f.outcome.requirements ?? []))

  // --- 7. Session plan.
  const planDirective = pickSessionPlan(fired.map((f) => f.outcome.sessionPlan))
  const plan = buildPlan(facts, planDirective, duration.totalMin, estimatedTotalCents)

  // --- 8. Deposit.
  const bandFloor = fired.reduce<DepositBand>(
    (acc, f) => ((f.outcome.depositBandFloor ?? 0) > acc ? f.outcome.depositBandFloor! : acc),
    0,
  )
  const deposit = computeDeposit({
    facts,
    complexityScore,
    maxSeverity,
    bandFloor,
    sessionCount: plan.sessionCount,
    firstSessionCents: plan.sessions[0]?.estimatedPriceCents ?? estimatedTotalCents,
    policy: opts.depositPolicy ?? DEFAULT_DEPOSIT_POLICY,
  })

  // --- 9. Mode and recommendation.
  const mode = pickMode(fired, requirements)
  const recommendedDecision = recommend({
    maxSeverity,
    blocksOnlineBooking,
    complexityScore,
    mode,
    hasDataQualityIssue: flags.some((f) => f.category === 'DATA_QUALITY'),
  })

  return {
    rulesetVersion: ruleset.version,
    rulesetHash: rulesetHash(ruleset),
    inputHash: hashOf(facts),
    evaluatedAt: today,
    firedRules: fired
      .map((f) => ({ ruleId: f.rule.id, ruleVersion: f.rule.version }))
      .sort((a, b) => (a.ruleId < b.ruleId ? -1 : 1)),
    flags,
    maxSeverity,
    blocksOnlineBooking,
    complexity: {
      score: complexityScore,
      band: complexityBand(complexityScore),
      breakdown: complexityBreakdown,
    },
    duration,
    price,
    deposit,
    requirements,
    mode,
    plan,
    recommendedDecision,
  }
}

// --- Duration ---------------------------------------------------------------

function computeDuration(
  facts: ConsultationFacts,
  fired: { rule: Rule; outcome: RuleOutcome }[],
  ruleset: Ruleset,
) {
  const breakdown: DurationBreakdownEntry[] = []

  let base = 0
  for (const service of facts.request.services) {
    const serviceMin = service.phases.reduce((sum, p) => sum + p.durationMin, 0)
    base += serviceMin
    breakdown.push({ source: 'BASE', label: service.name, deltaMin: serviceMin })
  }

  // Hair factors scale only the phases that are actually about hair volume.
  // Processing time is chemistry — it does not get longer because hair is long.
  const scalableMin = facts.request.services.reduce(
    (sum, s) => sum + s.phases.filter((p) => p.isScalable).reduce((a, p) => a + p.durationMin, 0),
    0,
  )
  const lengthFactor = LENGTH_FACTOR[facts.hair.lengthCategory]
  const densityFactor = DENSITY_FACTOR[facts.hair.density]
  const textureFactor = TEXTURE_FACTOR[facts.hair.texture]
  const hairFactor = lengthFactor * densityFactor * textureFactor
  const hairDelta = Math.round(scalableMin * (hairFactor - 1))
  if (hairDelta !== 0) {
    breakdown.push({
      source: 'MODIFIER',
      label: `${titleCase(facts.hair.lengthCategory)} length, ${facts.hair.density.toLowerCase()} density, ${facts.hair.texture.toLowerCase()} texture`,
      deltaMin: hairDelta,
    })
  }

  // Rule additions, summed (commutative).
  const adds = fired.flatMap((f) => (f.outcome.duration ?? []).map((d) => ({ rule: f.rule.id, d })))
  let ruleAdd = 0
  for (const { rule, d } of adds.filter((x) => x.d.op === 'ADD_MINUTES')) {
    ruleAdd += d.value
    breakdown.push({ source: 'RULE', label: `${rule}: ${d.reason}`, deltaMin: d.value })
  }

  let subtotal = base + hairDelta + ruleAdd

  // Multipliers applied in ruleId order so the result is order-independent.
  const mults = adds.filter((x) => x.d.op === 'MULTIPLY').sort((a, b) => (a.rule < b.rule ? -1 : 1))
  for (const { rule, d } of mults) {
    const applyTo = scopeShare(d, facts, subtotal)
    const delta = Math.round(applyTo * (d.value - 1))
    subtotal += delta
    breakdown.push({ source: 'RULE', label: `${rule}: ${d.reason}`, multiplier: d.value })
  }

  // Stylist calibration — how this stylist's actual times compare to estimates.
  const calibration =
    facts.request.stylistCalibrationSamples >= ruleset.settings.minCalibrationSamples
      ? clamp(
          facts.request.stylistDurationFactor,
          ruleset.settings.calibrationClamp.min,
          ruleset.settings.calibrationClamp.max,
        )
      : 1
  if (calibration !== 1) {
    breakdown.push({
      source: 'CALIBRATION',
      label: `Stylist pace (${facts.request.stylistCalibrationSamples} past appointments)`,
      multiplier: calibration,
    })
  }

  const totalMin = roundTo(subtotal * calibration, ruleset.settings.roundToMin)

  const confidence: 'LOW' | 'MEDIUM' | 'HIGH' =
    facts.photos.missingRequiredViews.length > 0
      ? 'LOW'
      : facts.request.stylistCalibrationSamples >= 12
        ? 'HIGH'
        : facts.request.stylistCalibrationSamples >= 5
          ? 'MEDIUM'
          : 'LOW'

  return { totalMin, breakdown, confidence }
}

function scopeShare(d: DurationAdjustment, facts: ConsultationFacts, subtotal: number): number {
  if (d.scope === 'TOTAL') return subtotal
  if ('phaseKind' in d.scope) {
    const kind = d.scope.phaseKind
    return facts.request.services.reduce(
      (sum, s) =>
        sum + s.phases.filter((p) => p.kind === kind).reduce((a, p) => a + p.durationMin, 0),
      0,
    )
  }
  const service = facts.request.services.find((s) => s.serviceId === d.scope.serviceId)
  return service ? service.phases.reduce((a, p) => a + p.durationMin, 0) : 0
}

const LENGTH_FACTOR: Record<ConsultationFacts['hair']['lengthCategory'], number> = {
  PIXIE: 0.8,
  CHIN: 0.9,
  SHOULDER: 1.0,
  COLLARBONE: 1.1,
  MID_BACK: 1.25,
  WAIST: 1.4,
  HIP: 1.55,
}
const DENSITY_FACTOR = { LOW: 0.92, MEDIUM: 1.0, HIGH: 1.15 } as const
const TEXTURE_FACTOR = { FINE: 0.95, MEDIUM: 1.0, COARSE: 1.1 } as const

// --- Requirements -----------------------------------------------------------

function dedupeRequirements(
  directives: readonly {
    kind: ResolvedRequirement['kind']
    dueBefore: ResolvedRequirement['dueBefore']
    sessionSequence?: number
    leadHours?: number
    formTemplateKey?: string
    rationale: string
  }[],
): ResolvedRequirement[] {
  const byKey = new Map<string, ResolvedRequirement>()

  for (const d of directives) {
    const key = `${d.kind}|${d.sessionSequence ?? 'any'}|${d.formTemplateKey ?? ''}`
    const existing = byKey.get(key)
    const candidate: ResolvedRequirement = {
      kind: d.kind,
      dueBefore: d.dueBefore,
      sessionSequence: d.sessionSequence ?? null,
      leadHours: d.leadHours ?? null,
      formTemplateKey: d.formTemplateKey ?? null,
      rationale: d.rationale,
    }
    if (!existing) {
      byKey.set(key, candidate)
      continue
    }
    // Keep the stricter of the two: BOOKING beats SESSION, longer lead wins.
    byKey.set(key, {
      ...existing,
      dueBefore:
        existing.dueBefore === 'BOOKING' || candidate.dueBefore === 'BOOKING'
          ? 'BOOKING'
          : 'SESSION',
      leadHours: Math.max(existing.leadHours ?? 0, candidate.leadHours ?? 0) || null,
    })
  }

  return [...byKey.values()].sort((a, b) =>
    a.kind === b.kind
      ? (a.sessionSequence ?? 0) - (b.sessionSequence ?? 0)
      : a.kind < b.kind
        ? -1
        : 1,
  )
}

// --- Session plan -----------------------------------------------------------

function pickSessionPlan(
  directives: readonly (SessionPlanDirective | undefined)[],
): SessionPlanDirective | null {
  const present = directives.filter((d): d is SessionPlanDirective => d !== undefined)
  if (present.length === 0) return null
  // Most sessions wins; ties broken by strategy name so the choice is stable.
  return present.reduce((best, d) =>
    d.minSessions > best.minSessions
      ? d
      : d.minSessions === best.minSessions && d.strategy < best.strategy
        ? d
        : best,
  )
}

function buildPlan(
  facts: ConsultationFacts,
  directive: SessionPlanDirective | null,
  totalMin: number,
  totalCents: number,
): EvaluationResult['plan'] {
  const serviceIds = facts.request.services.map((s) => s.serviceId)

  if (!directive || directive.minSessions <= 1) {
    return {
      sessionCount: 1,
      strategy: null,
      sessions: [
        {
          sequence: 1,
          label: facts.request.services.map((s) => s.name).join(' + ') || 'Appointment',
          serviceIds,
          estimatedDurationMin: totalMin,
          estimatedPriceCents: totalCents,
          depositCents: 0,
          minDaysAfterPrevious: null,
          maxDaysAfterPrevious: null,
        },
      ],
      rationale: 'This can be done in a single visit.',
    }
  }

  const count = directive.minSessions
  // Front-load: the first session of a correction is always the longest and
  // most expensive, and splitting evenly would misprice it badly.
  const weights = count === 2 ? [0.6, 0.4] : count === 3 ? [0.45, 0.35, 0.2] : evenWeights(count)

  const sessions: PlannedSession[] = weights.map((w, i) => ({
    sequence: i + 1,
    label: directive.sessionLabels?.[i] ?? `Session ${i + 1}`,
    serviceIds,
    estimatedDurationMin: roundTo(totalMin * w, 5),
    estimatedPriceCents: Math.round(totalCents * w),
    depositCents: 0,
    minDaysAfterPrevious: i === 0 ? null : (directive.spacingDays[i - 1]?.minDays ?? 42),
    maxDaysAfterPrevious: i === 0 ? null : (directive.spacingDays[i - 1]?.maxDays ?? 84),
  }))

  return {
    sessionCount: count,
    strategy: directive.strategy,
    sessions,
    rationale: directive.rationale,
  }
}

function evenWeights(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n)
}

// --- Deposit ----------------------------------------------------------------

function computeDeposit(input: {
  facts: ConsultationFacts
  complexityScore: number
  maxSeverity: Severity | 'NONE'
  bandFloor: DepositBand
  sessionCount: number
  firstSessionCents: number
  policy: DepositPolicyInput
}): EvaluationResult['deposit'] {
  const reasons: { band: DepositBand; why: string }[] = [
    { band: bandFromComplexity(input.complexityScore), why: 'service complexity' },
    { band: bandFromSeverity(input.maxSeverity), why: 'risk level' },
    { band: input.bandFloor, why: 'a specific risk rule' },
    { band: input.sessionCount > 1 ? 2 : 0, why: 'this being a multi-session plan' },
    {
      band: input.facts.isNewToSalon && input.complexityScore >= 20 ? 2 : 0,
      why: 'a first visit with a complex service',
    },
    { band: input.facts.priorNoShows >= 2 ? 2 : 0, why: 'previous missed appointments' },
  ]

  const winner = reasons.reduce((best, r) => (r.band > best.band ? r : best))
  const band = winner.band

  const pct = input.policy.bandPercentBps[band] / 10_000
  const min = input.policy.bandMinCents[band]
  const raw = band === 0 ? 0 : Math.max(Math.round(input.firstSessionCents * pct), min)
  const amountCents = Math.min(raw, input.policy.capCents)

  return {
    band,
    amountCents,
    rationale:
      band === 0
        ? 'No deposit needed for this booking.'
        : `Set by ${winner.why}. Deposits go towards the cost of your appointment.`,
  }
}

function bandFromComplexity(score: number): DepositBand {
  if (score >= 70) return 3
  if (score >= 40) return 2
  if (score >= 20) return 1
  return 0
}

function bandFromSeverity(sev: Severity | 'NONE'): DepositBand {
  switch (sev) {
    case 'BLOCKER':
      return 3
    case 'HIGH':
      return 2
    case 'CAUTION':
      return 1
    default:
      return 0
  }
}

// --- Mode & recommendation --------------------------------------------------

function pickMode(
  fired: { outcome: RuleOutcome }[],
  requirements: readonly ResolvedRequirement[],
): ConsultationMode {
  if (fired.some((f) => f.outcome.forcesMode === 'IN_PERSON')) return 'IN_PERSON'
  if (requirements.some((r) => r.kind === 'IN_PERSON_CONSULT')) return 'IN_PERSON'
  if (fired.some((f) => f.outcome.forcesMode === 'VIDEO')) return 'VIDEO'
  return 'PHOTO'
}

function recommend(input: {
  maxSeverity: Severity | 'NONE'
  blocksOnlineBooking: boolean
  complexityScore: number
  mode: ConsultationMode
  hasDataQualityIssue: boolean
}): RecommendedDecision {
  if (input.blocksOnlineBooking) return 'DECLINE_ONLINE'
  if (input.mode === 'IN_PERSON') return 'REQUIRE_IN_PERSON'
  if (
    !input.hasDataQualityIssue &&
    input.complexityScore < 20 &&
    (input.maxSeverity === 'NONE' || input.maxSeverity === 'INFO')
  ) {
    // Even this still requires a stylist to click approve unless the salon has
    // explicitly opted into auto-approval for simple, unflagged services.
    return 'AUTO_APPROVE_ELIGIBLE'
  }
  return 'STYLIST_REVIEW'
}

function complexityBand(score: number): 'SIMPLE' | 'MODERATE' | 'COMPLEX' | 'CORRECTIVE' {
  if (score >= 70) return 'CORRECTIVE'
  if (score >= 40) return 'COMPLEX'
  if (score >= 20) return 'MODERATE'
  return 'SIMPLE'
}

// --- Small helpers ----------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')
}
