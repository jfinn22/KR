import { describe, expect, it } from 'vitest'
import { CALIBRATION, computeCalibration, percentile, trim } from '@/domain/analytics/calibration'

/**
 * Calibration is a feedback loop into pricing and scheduling, so its guards
 * matter more than its accuracy. A factor that swings on two bad days would
 * make every estimate worse, not better.
 */

const repeat = (value: number, times: number) => Array.from({ length: times }, () => value)

describe('percentile', () => {
  it('interpolates', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(percentile([1, 2, 3], 0.5)).toBe(2)
  })

  it('handles the empty case without dividing by zero', () => {
    expect(percentile([], 0.5)).toBe(1)
  })
})

describe('trimming', () => {
  it('drops the extremes once there is enough data', () => {
    const values = [0.1, 1, 1, 1, 1, 1, 1, 1, 1, 9]
    const trimmed = trim(values, 0.1)
    expect(trimmed).not.toContain(0.1)
    expect(trimmed).not.toContain(9)
  })

  it('leaves a small sample alone — there is nothing to trim toward', () => {
    expect(trim([0.5, 1, 2], 0.1)).toEqual([0.5, 1, 2])
  })
})

describe('computeCalibration', () => {
  it('returns a neutral factor with no data', () => {
    const result = computeCalibration([])
    expect(result.factor).toBe(1)
    expect(result.confidence).toBe('LOW')
  })

  // The guard that matters most: a couple of bad days must not move anything.
  it('ignores a sample below the minimum', () => {
    const result = computeCalibration([1.8, 1.9, 2.0])
    expect(result.factor).toBe(1)
    expect(result.confidence).toBe('LOW')
  })

  it('moves toward the observed median as evidence accumulates', () => {
    const few = computeCalibration(repeat(1.3, 5))
    const many = computeCalibration(repeat(1.3, 60))
    expect(few.factor).toBeGreaterThan(1)
    expect(many.factor).toBeGreaterThan(few.factor)
    expect(many.factor).toBeLessThanOrEqual(1.3)
  })

  it('shrinks toward 1.0 rather than trusting the median outright', () => {
    const result = computeCalibration(repeat(1.4, 8))
    // With n=8 and a prior of 8, the factor should land about halfway.
    expect(result.factor).toBeGreaterThan(1.1)
    expect(result.factor).toBeLessThan(1.3)
  })

  it('clamps an absurd factor rather than believing it', () => {
    const tooSlow = computeCalibration(repeat(5, 200))
    const tooFast = computeCalibration(repeat(0.1, 200))
    expect(tooSlow.factor).toBe(CALIBRATION.clampMax)
    expect(tooFast.factor).toBe(CALIBRATION.clampMin)
  })

  it('reports a stylist who consistently runs fast', () => {
    const result = computeCalibration(repeat(0.85, 40))
    expect(result.factor).toBeLessThan(1)
    expect(result.confidence).toBe('HIGH')
  })

  it('discards non-finite and non-positive ratios', () => {
    const result = computeCalibration([1.2, NaN, Infinity, -1, 0, 1.2, 1.2, 1.2, 1.2])
    expect(result.sampleCount).toBeGreaterThan(0)
    expect(Number.isFinite(result.factor)).toBe(true)
  })

  it('is not dragged by a single interrupted appointment', () => {
    const steady = repeat(1.0, 20)
    const withOutlier = [...steady, 12]
    const a = computeCalibration(steady)
    const b = computeCalibration(withOutlier)
    expect(Math.abs(b.factor - a.factor)).toBeLessThan(0.05)
  })
})
