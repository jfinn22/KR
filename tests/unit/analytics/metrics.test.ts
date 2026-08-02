import { describe, expect, it } from 'vitest'
import {
  MIN_SAMPLE,
  analyseFlags,
  buildFunnel,
  comparePeriods,
  computeAccuracy,
  computeUtilisation,
  median,
  worstDropOff,
} from '@/domain/analytics/metrics'

/**
 * An owner makes staffing and pricing decisions on these numbers, so the tests
 * are as much about what the metrics refuse to say as what they report. A rate
 * derived from four consultations is noise, and dressing it up as a percentage
 * is worse than showing nothing.
 */

describe('the consultation funnel', () => {
  const stages = [
    { key: 'started', label: 'Started', count: 100 },
    { key: 'answered', label: 'Answered', count: 80 },
    { key: 'photos', label: 'Photos', count: 40 },
    { key: 'submitted', label: 'Submitted', count: 36 },
    { key: 'booked', label: 'Booked', count: 30 },
  ]

  it('reports conversion at each step and from the top', () => {
    const funnel = buildFunnel(stages)

    expect(funnel[0]!.conversionFromPrevious).toBeNull()
    expect(funnel[1]!.conversionFromPrevious).toBeCloseTo(0.8)
    expect(funnel[2]!.conversionFromPrevious).toBeCloseTo(0.5)
    expect(funnel[4]!.conversionFromStart).toBeCloseTo(0.3)
  })

  it('names what fell out at each step', () => {
    const funnel = buildFunnel(stages)
    expect(funnel[2]!.droppedHere).toBe(40)
    expect(funnel[0]!.droppedHere).toBe(0)
  })

  // "62% conversion" is a number; "half of them stop at photos" is a fix.
  it('points at the biggest single drop', () => {
    const worst = worstDropOff(buildFunnel(stages))
    expect(worst?.key).toBe('photos')
  })

  it('says nothing rather than guessing from a handful', () => {
    const funnel = buildFunnel([
      { key: 'started', label: 'Started', count: 4 },
      { key: 'booked', label: 'Booked', count: 1 },
    ])
    expect(funnel[1]!.conversionFromPrevious).toBeNull()
    expect(funnel[1]!.conversionFromStart).toBeNull()
  })

  it('handles an empty funnel without dividing by zero', () => {
    expect(buildFunnel([])).toEqual([])
    expect(worstDropOff([])).toBeNull()
  })

  it('does not report a negative drop when a stage grows', () => {
    const funnel = buildFunnel([
      { key: 'a', label: 'A', count: 10 },
      { key: 'b', label: 'B', count: 12 },
    ])
    expect(funnel[1]!.droppedHere).toBe(0)
  })
})

describe('quote accuracy', () => {
  const on = (n: number) => ({ estimatedMin: 120, actualMin: 120 + n })

  it('reports how often the estimate held', () => {
    const result = computeAccuracy([on(0), on(5), on(-5), on(10), on(-10), on(30), on(0), on(5)])
    expect(result.sampleCount).toBe(8)
    expect(result.withinToleranceRate).toBeCloseTo(7 / 8)
  })

  /*
   * Median, not mean: one four-hour correction that ran two hours over would
   * drag an average into fiction and hide an otherwise reliable salon.
   */
  it('is not dragged around by a single disaster', () => {
    const samples = [on(0), on(2), on(-2), on(1), on(0), on(-1), on(3), on(0), on(240)]
    const result = computeAccuracy(samples)
    expect(result.medianErrorMin).toBeLessThan(5)
  })

  // Precision and bias are different problems with different fixes.
  it('separates being imprecise from being consistently short', () => {
    const noisy = computeAccuracy([
      on(20),
      on(-20),
      on(20),
      on(-20),
      on(20),
      on(-20),
      on(20),
      on(-20),
    ])
    expect(noisy.medianBiasMin).toBeCloseTo(0)
    expect(noisy.medianErrorMin).toBeCloseTo(20)

    const short = computeAccuracy([on(20), on(22), on(18), on(21), on(19), on(20), on(23), on(17)])
    expect(short.medianBiasMin).toBeGreaterThan(15)
  })

  it('counts overruns and underruns separately', () => {
    const result = computeAccuracy([on(30), on(30), on(-30), on(0)])
    expect(result.overranCount).toBe(2)
    expect(result.underranCount).toBe(1)
  })

  it('withholds a rate below the sample floor', () => {
    const result = computeAccuracy([on(0), on(5)])
    expect(result.sampleCount).toBe(2)
    expect(result.withinToleranceRate).toBeNull()
    expect(result.medianErrorMin).toBeNull()
  })

  it('ignores rows with no usable timing', () => {
    const result = computeAccuracy([
      { estimatedMin: 0, actualMin: 100 },
      { estimatedMin: 100, actualMin: 0 },
    ])
    expect(result.sampleCount).toBe(0)
  })

  it('respects a custom tolerance', () => {
    const samples = Array.from({ length: MIN_SAMPLE }, () => on(20))
    expect(computeAccuracy(samples, 15).withinToleranceRate).toBe(0)
    expect(computeAccuracy(samples, 30).withinToleranceRate).toBe(1)
  })
})

describe('utilisation', () => {
  it('reports raw chair time against the roster', () => {
    const result = computeUtilisation({ availableMin: 480, chairMin: 360, interleavedMin: 0 })
    expect(result.utilisation).toBeCloseTo(0.75)
    expect(result.idleMin).toBe(120)
  })

  /*
   * The gap between the two figures is exactly what interleaving is worth,
   * and it is the number that justifies turning the feature on.
   */
  it('shows what interleaving added on top', () => {
    const result = computeUtilisation({ availableMin: 480, chairMin: 360, interleavedMin: 90 })
    expect(result.utilisation).toBeCloseTo(0.75)
    expect(result.effectiveUtilisation).toBeCloseTo(0.9375)
  })

  it('never exceeds 100% however the minutes are counted', () => {
    const result = computeUtilisation({ availableMin: 100, chairMin: 90, interleavedMin: 90 })
    expect(result.effectiveUtilisation).toBe(1)
  })

  it('reports nothing for a stylist who was not rostered', () => {
    const result = computeUtilisation({ availableMin: 0, chairMin: 0, interleavedMin: 0 })
    expect(result.utilisation).toBeNull()
  })
})

describe('rule quality', () => {
  /*
   * A rule overridden four times in five is not protecting anybody — it is
   * training stylists to click through warnings, which makes every other flag
   * less effective.
   */
  it('flags a rule people routinely overrule', () => {
    const insights = analyseFlags([
      { code: 'BOX_DYE_HIGH_LIFT', fired: 40, overridden: 2 },
      { code: 'INSUFFICIENT_PHOTOS', fired: 30, overridden: 24 },
    ])

    expect(insights[0]!.code).toBe('BOX_DYE_HIGH_LIFT')
    expect(insights[0]!.needsReview).toBe(false)

    const noisy = insights.find((i) => i.code === 'INSUFFICIENT_PHOTOS')!
    expect(noisy.overrideRate).toBeCloseTo(0.8)
    expect(noisy.needsReview).toBe(true)
  })

  it('does not condemn a rule on two data points', () => {
    const insights = analyseFlags([{ code: 'RARE', fired: 3, overridden: 3 }])
    expect(insights[0]!.overrideRate).toBeNull()
    expect(insights[0]!.needsReview).toBe(false)
  })

  it('orders by how often each rule actually fires', () => {
    const insights = analyseFlags([
      { code: 'A', fired: 5, overridden: 0 },
      { code: 'B', fired: 50, overridden: 0 },
    ])
    expect(insights.map((i) => i.code)).toEqual(['B', 'A'])
  })
})

describe('period comparison', () => {
  const from = new Date('2026-08-01T00:00:00Z')
  const to = new Date('2026-08-08T00:00:00Z')

  it('pairs a figure with the period before it', () => {
    const result = comparePeriods(
      [
        { cents: 10000, at: new Date('2026-08-02T10:00:00Z') },
        { cents: 5000, at: new Date('2026-08-05T10:00:00Z') },
        { cents: 12000, at: new Date('2026-07-28T10:00:00Z') },
      ],
      { from, to },
    )

    expect(result.currentCents).toBe(15000)
    expect(result.previousCents).toBe(12000)
    expect(result.changeRate).toBeCloseTo(0.25)
  })

  // "Up ∞%" is not information.
  it('reports no change rate when there is no baseline', () => {
    const result = comparePeriods([{ cents: 10000, at: new Date('2026-08-02T10:00:00Z') }], {
      from,
      to,
    })
    expect(result.previousCents).toBe(0)
    expect(result.changeRate).toBeNull()
  })

  it('excludes anything outside both windows', () => {
    const result = comparePeriods([{ cents: 99999, at: new Date('2026-06-01T10:00:00Z') }], {
      from,
      to,
    })
    expect(result.currentCents).toBe(0)
    expect(result.previousCents).toBe(0)
  })
})

describe('median', () => {
  it('takes the middle of an odd set', () => {
    expect(median([3, 1, 2])).toBe(2)
  })

  it('averages the middle two of an even set', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('returns zero for nothing rather than NaN', () => {
    expect(median([])).toBe(0)
  })

  it('does not mutate its input', () => {
    const values = [3, 1, 2]
    median(values)
    expect(values).toEqual([3, 1, 2])
  })
})
