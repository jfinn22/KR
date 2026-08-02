/**
 * Turning rows into numbers an owner can act on.
 *
 * Pure, so every figure on the dashboard is reproducible and testable without
 * a database. Three ideas run through it:
 *
 *  - Say "not enough data" rather than guessing. A conversion rate from four
 *    consultations is noise, and presenting it as a percentage invites a salon
 *    to make a staffing decision on it. Every rate here can return null.
 *  - Measure chair time, never booked time. Booked time expands to fill the
 *    slot allocated, so an accuracy metric built on it converges on 100% and
 *    means nothing.
 *  - A funnel is only useful if the drop-offs are named. "62% conversion" is a
 *    number; "most people stop at the photo step" is something to fix.
 */

/** Below this, a rate is noise dressed as insight. */
export const MIN_SAMPLE = 8

export interface FunnelStage {
  key: string
  label: string
  count: number
}

export interface FunnelStep extends FunnelStage {
  /** Share of the stage before it. Null at the top, and when too few entered. */
  conversionFromPrevious: number | null
  /** Share of the very first stage. */
  conversionFromStart: number | null
  droppedHere: number
}

/**
 * The consultation funnel.
 *
 * Each step reports what fell out at that point, which is the only actionable
 * form: a salon cannot fix "62% overall" but can fix "half of them stop at
 * photos".
 */
export function buildFunnel(stages: readonly FunnelStage[]): FunnelStep[] {
  const first = stages[0]?.count ?? 0

  return stages.map((stage, index) => {
    const previous = index === 0 ? null : (stages[index - 1]?.count ?? 0)

    return {
      ...stage,
      conversionFromPrevious:
        previous === null || previous < MIN_SAMPLE ? null : stage.count / previous,
      conversionFromStart: first < MIN_SAMPLE ? null : stage.count / first,
      droppedHere: previous === null ? 0 : Math.max(0, previous - stage.count),
    }
  })
}

/** Where the biggest single drop happens — the one thing worth fixing first. */
export function worstDropOff(steps: readonly FunnelStep[]): FunnelStep | null {
  const candidates = steps.filter((step) => step.droppedHere > 0)
  if (candidates.length === 0) return null

  return candidates.reduce((worst, step) => (step.droppedHere > worst.droppedHere ? step : worst))
}

export interface AccuracySample {
  estimatedMin: number
  /** Chair time. Booked time would make this metric self-confirming. */
  actualMin: number
}

export interface AccuracyResult {
  sampleCount: number
  /** Share landing inside the tolerance band. Null below MIN_SAMPLE. */
  withinToleranceRate: number | null
  medianErrorMin: number | null
  /** Positive means the salon consistently under-quotes. */
  medianBiasMin: number | null
  overranCount: number
  underranCount: number
}

/**
 * How good the estimates actually are.
 *
 * The product's central claim, so it is measured honestly: median rather than
 * mean, because one four-hour correction that ran two hours over would drag an
 * average into fiction.
 *
 * Bias is reported separately from error on purpose. A salon that is 20 minutes
 * out in both directions has a precision problem; one that is 20 minutes short
 * every single time has a pricing problem, and the fixes are different.
 */
export function computeAccuracy(
  samples: readonly AccuracySample[],
  toleranceMin = 15,
): AccuracyResult {
  const usable = samples.filter((s) => s.estimatedMin > 0 && s.actualMin > 0)

  if (usable.length === 0) {
    return {
      sampleCount: 0,
      withinToleranceRate: null,
      medianErrorMin: null,
      medianBiasMin: null,
      overranCount: 0,
      underranCount: 0,
    }
  }

  const errors = usable.map((s) => s.actualMin - s.estimatedMin)
  const withinTolerance = errors.filter((e) => Math.abs(e) <= toleranceMin).length

  return {
    sampleCount: usable.length,
    withinToleranceRate: usable.length >= MIN_SAMPLE ? withinTolerance / usable.length : null,
    medianErrorMin: usable.length >= MIN_SAMPLE ? median(errors.map(Math.abs)) : null,
    medianBiasMin: usable.length >= MIN_SAMPLE ? median(errors) : null,
    overranCount: errors.filter((e) => e > toleranceMin).length,
    underranCount: errors.filter((e) => e < -toleranceMin).length,
  }
}

export interface UtilisationInput {
  /** Minutes the stylist was rostered on. */
  availableMin: number
  /** Minutes they actually held a client — chair time, not booked time. */
  chairMin: number
  /** Minutes released to somebody else during processing. */
  interleavedMin: number
}

export interface UtilisationResult {
  utilisation: number | null
  /** What interleaving added on top of a straight chair-time reading. */
  effectiveUtilisation: number | null
  idleMin: number
}

/**
 * How much of a rostered day turned into work.
 *
 * Reported twice: raw chair time, and effective — which counts the minutes
 * handed to another client during processing. The gap between the two is
 * exactly what interleaving is worth to this salon, and it is the number that
 * justifies turning the feature on.
 */
export function computeUtilisation(input: UtilisationInput): UtilisationResult {
  if (input.availableMin <= 0) {
    return { utilisation: null, effectiveUtilisation: null, idleMin: 0 }
  }

  return {
    utilisation: clamp01(input.chairMin / input.availableMin),
    effectiveUtilisation: clamp01((input.chairMin + input.interleavedMin) / input.availableMin),
    idleMin: Math.max(0, input.availableMin - input.chairMin),
  }
}

export interface FlagFrequency {
  code: string
  fired: number
  overridden: number
}

export interface FlagInsight extends FlagFrequency {
  /** High means the rule fires and people routinely disagree with it. */
  overrideRate: number | null
  /** A rule overridden most of the time is a rule that needs changing. */
  needsReview: boolean
}

/**
 * Which rules earn their place.
 *
 * A rule stylists override four times out of five is not protecting anybody —
 * it is training them to click through warnings, which makes every other flag
 * less effective. Surfacing that is how the ruleset stays worth reading.
 */
export function analyseFlags(rows: readonly FlagFrequency[]): FlagInsight[] {
  return rows
    .map((row): FlagInsight => {
      const overrideRate = row.fired >= MIN_SAMPLE ? row.overridden / row.fired : null
      return {
        ...row,
        overrideRate,
        needsReview: overrideRate !== null && overrideRate >= 0.5,
      }
    })
    .sort((a, b) => b.fired - a.fired)
}

export interface RevenueSample {
  cents: number
  at: Date
}

/**
 * Revenue split by period, with the previous period alongside.
 *
 * Always paired: a single figure invites a salon to read noise as a trend, and
 * "£4,200 — up 8% on last week" is the smallest honest unit of information.
 */
export function comparePeriods(
  samples: readonly RevenueSample[],
  opts: { from: Date; to: Date },
): { currentCents: number; previousCents: number; changeRate: number | null } {
  const spanMs = opts.to.getTime() - opts.from.getTime()
  const previousFrom = new Date(opts.from.getTime() - spanMs)

  const current = sumWithin(samples, opts.from, opts.to)
  const previous = sumWithin(samples, previousFrom, opts.from)

  return {
    currentCents: current,
    previousCents: previous,
    // No baseline means no percentage. "Up ∞%" is not information.
    changeRate: previous > 0 ? (current - previous) / previous : null,
  }
}

function sumWithin(samples: readonly RevenueSample[], from: Date, to: Date): number {
  return samples.filter((s) => s.at >= from && s.at < to).reduce((total, s) => total + s.cents, 0)
}

// --- Helpers ----------------------------------------------------------------

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0)
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
