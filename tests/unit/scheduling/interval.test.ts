import { describe, expect, it } from 'vitest'
import {
  contains,
  coverageAt,
  fitsWithin,
  interval,
  intersect,
  merge,
  overlaps,
  peakCoverage,
  subtract,
  totalDuration,
} from '@/domain/scheduling/interval'

const i = (start: number, end: number) => ({ start, end })

describe('interval construction', () => {
  it('rejects an inverted range', () => {
    expect(() => interval(100, 50)).toThrow(RangeError)
  })

  it('allows a zero-length interval', () => {
    expect(interval(100, 100)).toEqual({ start: 100, end: 100 })
  })

  it('rejects non-finite bounds', () => {
    expect(() => interval(NaN, 10)).toThrow(RangeError)
    expect(() => interval(0, Infinity)).toThrow(RangeError)
  })
})

describe('overlap is half-open', () => {
  // The whole booking model depends on this: [9,10) and [10,11) do NOT overlap,
  // which is what makes back-to-back appointments legal.
  it('touching intervals do not overlap', () => {
    expect(overlaps(i(540, 600), i(600, 660))).toBe(false)
  })

  it('genuinely overlapping intervals do', () => {
    expect(overlaps(i(540, 660), i(600, 720))).toBe(true)
  })

  it('a zero-length interval overlaps nothing', () => {
    expect(overlaps(i(600, 600), i(540, 660))).toBe(false)
  })

  it('containment is inclusive of shared bounds', () => {
    expect(contains(i(540, 660), i(540, 660))).toBe(true)
    expect(contains(i(540, 660), i(560, 600))).toBe(true)
    expect(contains(i(540, 660), i(530, 600))).toBe(false)
  })
})

describe('merge', () => {
  it('coalesces overlapping intervals', () => {
    expect(merge([i(0, 60), i(30, 90)])).toEqual([i(0, 90)])
  })

  it('coalesces touching intervals', () => {
    expect(merge([i(0, 60), i(60, 120)])).toEqual([i(0, 120)])
  })

  it('leaves a genuine gap alone', () => {
    expect(merge([i(0, 60), i(90, 120)])).toEqual([i(0, 60), i(90, 120)])
  })

  it('sorts unordered input', () => {
    expect(merge([i(90, 120), i(0, 60)])).toEqual([i(0, 60), i(90, 120)])
  })

  it('drops empty intervals', () => {
    expect(merge([i(30, 30), i(0, 60)])).toEqual([i(0, 60)])
  })

  it('does not mutate its input', () => {
    const input = [i(0, 60), i(30, 90)]
    merge(input)
    expect(input).toEqual([i(0, 60), i(30, 90)])
  })
})

describe('subtract', () => {
  it('punches a hole in the middle', () => {
    expect(subtract([i(0, 120)], [i(40, 80)])).toEqual([i(0, 40), i(80, 120)])
  })

  it('trims the front', () => {
    expect(subtract([i(0, 120)], [i(0, 40)])).toEqual([i(40, 120)])
  })

  it('trims the back', () => {
    expect(subtract([i(0, 120)], [i(80, 200)])).toEqual([i(0, 80)])
  })

  it('removes an entirely covered interval', () => {
    expect(subtract([i(40, 80)], [i(0, 120)])).toEqual([])
  })

  it('ignores a non-overlapping blocker', () => {
    expect(subtract([i(0, 60)], [i(90, 120)])).toEqual([i(0, 60)])
  })

  it('a touching blocker removes nothing', () => {
    expect(subtract([i(0, 60)], [i(60, 120)])).toEqual([i(0, 60)])
  })

  it('applies several blockers', () => {
    expect(subtract([i(0, 240)], [i(60, 90), i(150, 180)])).toEqual([
      i(0, 60),
      i(90, 150),
      i(180, 240),
    ])
  })

  it('handles a realistic working day with lunch and two bookings', () => {
    const day = [i(540, 1020)] // 09:00–17:00
    const busy = [i(720, 780), i(600, 690), i(840, 960)]
    expect(subtract(day, busy)).toEqual([i(540, 600), i(690, 720), i(780, 840), i(960, 1020)])
  })
})

describe('intersect', () => {
  it('returns the common part', () => {
    expect(intersect([i(0, 120)], [i(60, 180)])).toEqual([i(60, 120)])
  })

  it('returns nothing when disjoint', () => {
    expect(intersect([i(0, 60)], [i(60, 120)])).toEqual([])
  })

  it('handles many-to-many', () => {
    expect(intersect([i(0, 100), i(200, 300)], [i(50, 250)])).toEqual([i(50, 100), i(200, 250)])
  })
})

describe('fitsWithin', () => {
  const free = [i(540, 660), i(720, 900)]

  it('accepts a candidate inside one block', () => {
    expect(fitsWithin(free, i(560, 620))).toBe(true)
  })

  it('rejects a candidate spanning a gap', () => {
    // This is the case that matters: an appointment cannot straddle a break.
    expect(fitsWithin(free, i(640, 740))).toBe(false)
  })

  it('accepts a candidate exactly filling a block', () => {
    expect(fitsWithin(free, i(720, 900))).toBe(true)
  })
})

describe('coverage', () => {
  it('counts intervals covering a point, half-open', () => {
    const spans = [i(0, 60), i(30, 90), i(60, 120)]
    expect(coverageAt(spans, 45)).toBe(2)
    expect(coverageAt(spans, 60)).toBe(2) // first ended, third started
    expect(coverageAt(spans, 0)).toBe(1)
  })

  it('finds peak simultaneous coverage in a window', () => {
    // Three clients in flight at once — the concurrency cap depends on this.
    const spans = [i(0, 100), i(20, 80), i(40, 60)]
    expect(peakCoverage(spans, i(0, 100))).toBe(3)
    expect(peakCoverage(spans, i(80, 100))).toBe(1)
  })

  it('back-to-back spans never peak above one', () => {
    expect(peakCoverage([i(0, 60), i(60, 120), i(120, 180)], i(0, 180))).toBe(1)
  })

  it('ignores spans outside the window', () => {
    expect(peakCoverage([i(0, 60)], i(120, 180))).toBe(0)
  })
})

describe('totalDuration', () => {
  it('sums after merging so overlap is not double-counted', () => {
    expect(totalDuration([i(0, 60), i(30, 90)])).toBe(90)
    expect(totalDuration([i(0, 60), i(120, 180)])).toBe(120)
  })
})
