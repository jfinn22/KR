/**
 * How long this stylist actually takes, versus what we estimated.
 *
 * Pure. Takes ratios of actual/estimated and returns a factor the rules engine
 * multiplies into its duration estimate.
 *
 * Three deliberate guards, because a naive average here would be actively
 * harmful:
 *
 *  - **Shrinkage toward 1.0.** Two unusual appointments must not swing a
 *    stylist's every future estimate. The factor only moves as the evidence
 *    accumulates.
 *  - **Trimming.** An appointment interrupted by a walk-in is not evidence
 *    about how fast someone works.
 *  - **A hard clamp.** Even with a hundred samples the factor cannot leave
 *    [0.8, 1.35]. Beyond that something is wrong with the data, not the stylist.
 *
 * The caller must supply ratios computed from CHAIR time, not booked time —
 * booked time expands to fill the slot, which would make this self-fulfilling.
 */

export interface CalibrationResult {
  sampleCount: number
  median: number
  p90: number
  /** What to multiply an estimate by. 1.0 when there is not enough evidence. */
  factor: number
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
}

export const CALIBRATION = {
  /** Prior strength. Higher means slower to move away from 1.0. */
  priorStrength: 8,
  minSamples: 4,
  trimFraction: 0.1,
  clampMin: 0.8,
  clampMax: 1.35,
} as const

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 1
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]!
  return sorted[lower]! + (index - lower) * (sorted[upper]! - sorted[lower]!)
}

/** Drop the extreme tails, which are interruptions rather than pace. */
export function trim(values: readonly number[], fraction: number): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length < 5) return sorted
  const drop = Math.floor(sorted.length * fraction)
  return drop === 0 ? sorted : sorted.slice(drop, sorted.length - drop)
}

export function computeCalibration(ratios: readonly number[]): CalibrationResult {
  const usable = ratios.filter((r) => Number.isFinite(r) && r > 0)

  if (usable.length === 0) {
    return { sampleCount: 0, median: 1, p90: 1, factor: 1, confidence: 'LOW' }
  }

  const trimmed = trim(usable, CALIBRATION.trimFraction)
  const median = percentile(trimmed, 0.5)
  const p90 = percentile(trimmed, 0.9)
  const n = trimmed.length

  if (n < CALIBRATION.minSamples) {
    return { sampleCount: n, median, p90, factor: 1, confidence: 'LOW' }
  }

  // Empirical Bayes: pull toward 1.0 in proportion to how little we know.
  const shrunk = (n * median + CALIBRATION.priorStrength * 1) / (n + CALIBRATION.priorStrength)
  const factor = Math.min(CALIBRATION.clampMax, Math.max(CALIBRATION.clampMin, shrunk))

  return {
    sampleCount: n,
    median: round3(median),
    p90: round3(p90),
    factor: round3(factor),
    confidence: n >= 12 ? 'HIGH' : 'MEDIUM',
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000
