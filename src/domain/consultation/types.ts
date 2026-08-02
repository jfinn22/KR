import type { ConsultationFacts } from './facts'

/**
 * Rule and evaluation types.
 *
 * Rules are TypeScript functions in versioned directories, not a JSON DSL. A
 * DSL expressive enough for level arithmetic, month windows and skill
 * comparisons becomes an untyped programming language with a hand-rolled
 * interpreter — harder to test and harder to review, not easier.
 *
 * Explicability comes instead from three places: prose in `docs` beside the
 * logic, a mandatory `evidence` array on every flag so the UI can show exactly
 * which facts fired it, and the full input/output snapshot stored on the
 * evaluation row.
 */

export type Severity = 'INFO' | 'CAUTION' | 'HIGH' | 'BLOCKER'

export const SEVERITY_RANK: Record<Severity, number> = {
  INFO: 0,
  CAUTION: 1,
  HIGH: 2,
  BLOCKER: 3,
}

export type RuleCategory =
  | 'CHEMICAL_HISTORY'
  | 'INTEGRITY'
  | 'SCALP_HEALTH'
  | 'ALLERGY'
  | 'GOAL_FEASIBILITY'
  | 'COMPLIANCE'
  | 'LOGISTICS'
  | 'DATA_QUALITY'

export type PreStepKind =
  | 'PATCH_TEST'
  | 'STRAND_TEST'
  | 'IN_PERSON_CONSULT'
  | 'FORM_SIGNATURE'
  | 'PHOTO_RESUBMIT'
  | 'TREATMENT_COURSE'

export type ConsultationMode = 'DIGITAL' | 'PHOTO' | 'VIDEO' | 'IN_PERSON'

/** One fact that contributed to a flag, for "we flagged this because…". */
export interface FactRef {
  path: string
  value: unknown
  label: string
}

export interface DurationAdjustment {
  scope: 'TOTAL' | { serviceId: string } | { phaseKind: 'ACTIVE' | 'PROCESSING' }
  op: 'ADD_MINUTES' | 'MULTIPLY'
  value: number
  reason: string
}

export interface PriceAdjustment {
  scope: 'TOTAL' | { serviceId: string }
  op: 'ADD_CENTS' | 'MULTIPLY'
  value: number
  reason: string
}

export interface RequirementDirective {
  kind: PreStepKind
  dueBefore: 'BOOKING' | 'SESSION'
  sessionSequence?: number
  leadHours?: number
  formTemplateKey?: string
  rationale: string
}

export interface SessionPlanDirective {
  minSessions: number
  strategy:
    | 'GRADUAL_LIFT'
    | 'PREP_THEN_SERVICE'
    | 'REPAIR_PROGRAM'
    | 'COLOR_REMOVAL_FIRST'
    | 'TEST_THEN_PROCEED'
  /** Gap constraints between consecutive sessions; length is minSessions - 1. */
  spacingDays: readonly { minDays: number; maxDays: number }[]
  sessionLabels?: readonly string[]
  rationale: string
}

export type DepositBand = 0 | 1 | 2 | 3

export interface RuleOutcome {
  flag?: {
    code: string
    severity: Severity
    title: string
    detail: string
    evidence: readonly FactRef[]
    /**
     * REQUIRED. A flag that only says "no" trains stylists to ignore flags.
     * The type system is what makes a recommended path non-optional.
     */
    recommendedPath: string
    blocksOnlineBooking?: boolean
  }
  complexity?: { delta: number; reason: string }
  duration?: readonly DurationAdjustment[]
  price?: readonly PriceAdjustment[]
  requirements?: readonly RequirementDirective[]
  sessionPlan?: SessionPlanDirective
  /** Raise-only: the reducer takes the maximum across all rules. */
  depositBandFloor?: DepositBand
  forcesMode?: ConsultationMode
}

export interface RuleContext {
  readonly facts: ConsultationFacts
  /** Injected, never read from the system clock — replay must be exact. */
  readonly today: string
  readonly settings: EngineSettings
}

export interface Rule {
  readonly id: string
  /** Bump on ANY logic change. The ruleset hash folds this in. */
  readonly version: number
  readonly category: RuleCategory
  /** Cheap gate so the expensive branch only runs when relevant. */
  readonly appliesWhen?: (ctx: RuleContext) => boolean
  readonly evaluate: (ctx: RuleContext) => RuleOutcome | null
  readonly docs: {
    /** Why this rule exists. Shown to staff on the rules screen. */
    rationale: string
    /** Plain-language fallback used when the AI layer is off or unavailable. */
    clientExplanation: string
  }
}

export interface EngineSettings {
  /** Minutes; the granularity phase durations round to. */
  roundToMin: number
  depositCapCents: number
  /** Below this many calibration samples, the stylist factor is ignored. */
  minCalibrationSamples: number
  calibrationClamp: { min: number; max: number }
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  roundToMin: 5,
  depositCapCents: 50_000,
  minCalibrationSamples: 5,
  calibrationClamp: { min: 0.8, max: 1.35 },
}

export interface Ruleset {
  readonly version: string
  readonly rules: readonly Rule[]
  readonly settings: EngineSettings
}

// --- Output ----------------------------------------------------------------

export interface ResolvedRiskFlag {
  ruleId: string
  ruleVersion: number
  code: string
  severity: Severity
  category: RuleCategory
  title: string
  detail: string
  evidence: readonly FactRef[]
  recommendedPath: string
  blocksOnlineBooking: boolean
  clientExplanation: string
}

export interface ResolvedRequirement {
  kind: PreStepKind
  dueBefore: 'BOOKING' | 'SESSION'
  sessionSequence: number | null
  leadHours: number | null
  formTemplateKey: string | null
  rationale: string
}

export interface DurationBreakdownEntry {
  source: 'BASE' | 'VARIANT' | 'MODIFIER' | 'RULE' | 'CALIBRATION' | 'BUFFER'
  label: string
  deltaMin?: number
  multiplier?: number
}

export interface PlannedSession {
  sequence: number
  label: string
  serviceIds: readonly string[]
  estimatedDurationMin: number
  estimatedPriceCents: number
  depositCents: number
  minDaysAfterPrevious: number | null
  maxDaysAfterPrevious: number | null
}

export type RecommendedDecision =
  'AUTO_APPROVE_ELIGIBLE' | 'STYLIST_REVIEW' | 'REQUIRE_IN_PERSON' | 'DECLINE_ONLINE'

export interface EvaluationResult {
  readonly rulesetVersion: string
  readonly rulesetHash: string
  readonly inputHash: string
  readonly evaluatedAt: string
  readonly firedRules: readonly { ruleId: string; ruleVersion: number }[]

  readonly flags: readonly ResolvedRiskFlag[]
  readonly maxSeverity: Severity | 'NONE'
  readonly blocksOnlineBooking: boolean

  readonly complexity: {
    score: number
    band: 'SIMPLE' | 'MODERATE' | 'COMPLEX' | 'CORRECTIVE'
    breakdown: readonly { source: string; delta: number; reason: string }[]
  }

  readonly duration: {
    totalMin: number
    breakdown: readonly DurationBreakdownEntry[]
    /** Driven by calibration sample size and any DATA_QUALITY flags. */
    confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  }

  readonly price: {
    estimatedTotalCents: number
    isRange: boolean
    lowCents: number
    highCents: number
  }

  readonly deposit: {
    band: DepositBand
    amountCents: number
    rationale: string
  }

  readonly requirements: readonly ResolvedRequirement[]
  readonly mode: ConsultationMode

  readonly plan: {
    sessionCount: number
    strategy: string | null
    sessions: readonly PlannedSession[]
    rationale: string
  }

  /** A recommendation. Never an action — a human still clicks approve. */
  readonly recommendedDecision: RecommendedDecision
}
