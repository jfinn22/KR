import { describe, expect, it } from 'vitest'
import {
  ANY_TIME,
  EVERY_DAY,
  allowsDate,
  allowsStart,
  dayInMask,
  daysOf,
  describeWindow,
  isNarrowed,
  maskOf,
  startBoundsOn,
  windowFrom,
  windowSignature,
  type BookingWindow,
} from '@/domain/scheduling/window'
import { localTimeToEpochMinutes } from '@/domain/scheduling/zoned'

/**
 * The narrowing a stylist applies at approval, and the one a client puts on a
 * waitlist entry. Same shape, same filter, so the two can never disagree about
 * whether a Tuesday counts.
 */

const TZ = 'America/New_York'
// 2026-03-10 is a Tuesday; 2026-03-11 a Wednesday. Both after the US DST
// change on the 8th, so a day here is an ordinary 1440 minutes.
const TUE = '2026-03-10'
const WED = '2026-03-11'
const at = (date: string, hour: number) => localTimeToEpochMinutes(date, hour * 60, TZ)

const window = (overrides: Partial<BookingWindow> = {}): BookingWindow => ({
  ...ANY_TIME,
  ...overrides,
})

describe('the day mask', () => {
  it('reads Sunday as bit 0, matching WorkingHours', () => {
    expect(dayInMask(0b0000001, 0)).toBe(true)
    expect(dayInMask(0b0000001, 1)).toBe(false)
    expect(dayInMask(EVERY_DAY, 6)).toBe(true)
  })

  it('round-trips through maskOf and daysOf', () => {
    expect(daysOf(maskOf([2, 4]))).toEqual([2, 4])
    expect(daysOf(EVERY_DAY)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})

describe('whether a window narrows anything', () => {
  it('says no to the default', () => {
    expect(isNarrowed(ANY_TIME)).toBe(false)
  })

  it('says yes to each field on its own', () => {
    expect(isNarrowed(window({ dayOfWeekMask: maskOf([2, 4]) }))).toBe(true)
    expect(isNarrowed(window({ windowStartMinute: 540 }))).toBe(true)
    expect(isNarrowed(window({ windowEndMinute: 780 }))).toBe(true)
    expect(isNarrowed(window({ earliestDate: TUE }))).toBe(true)
    expect(isNarrowed(window({ latestDate: TUE }))).toBe(true)
  })
})

describe('ruling out a whole day', () => {
  it('keeps a day the mask includes', () => {
    // Tuesday is day 2.
    expect(allowsDate(window({ dayOfWeekMask: maskOf([2]) }), TUE, TZ)).toBe(true)
  })

  it('drops a day it does not', () => {
    expect(allowsDate(window({ dayOfWeekMask: maskOf([2]) }), WED, TZ)).toBe(false)
  })

  it('respects both ends of the date range, inclusively', () => {
    const w = window({ earliestDate: TUE, latestDate: WED })
    expect(allowsDate(w, TUE, TZ)).toBe(true)
    expect(allowsDate(w, WED, TZ)).toBe(true)
    expect(allowsDate(w, '2026-03-09', TZ)).toBe(false)
    expect(allowsDate(w, '2026-03-12', TZ)).toBe(false)
  })

  it('treats an open end as no bound rather than as today', () => {
    expect(allowsDate(window({ latestDate: WED }), '2020-01-01', TZ)).toBe(true)
  })
})

describe('where an appointment may start', () => {
  const mornings = window({ windowStartMinute: 9 * 60, windowEndMinute: 13 * 60 })

  it('allows a start inside the window', () => {
    expect(allowsStart(mornings, { localDate: TUE, startMin: at(TUE, 10) }, TZ)).toBe(true)
  })

  it('allows both edges, since a 9am start is a morning', () => {
    expect(allowsStart(mornings, { localDate: TUE, startMin: at(TUE, 9) }, TZ)).toBe(true)
    expect(allowsStart(mornings, { localDate: TUE, startMin: at(TUE, 13) }, TZ)).toBe(true)
  })

  it('refuses a start outside it', () => {
    expect(allowsStart(mornings, { localDate: TUE, startMin: at(TUE, 8) }, TZ)).toBe(false)
    expect(allowsStart(mornings, { localDate: TUE, startMin: at(TUE, 14) }, TZ)).toBe(false)
  })

  /*
   * The window bounds the START, not the finish. A stylist asking for mornings
   * on a five-hour correction is asking to begin while the light is good, not
   * for the impossible — bounding the finish would return nothing at all for
   * exactly the long services this narrowing exists to control.
   */
  it('does not care where a long appointment finishes', () => {
    expect(allowsStart(mornings, { localDate: TUE, startMin: at(TUE, 12) }, TZ)).toBe(true)
  })

  it('applies the day mask as well as the clock', () => {
    const tuesdayMornings = window({
      dayOfWeekMask: maskOf([2]),
      windowStartMinute: 9 * 60,
      windowEndMinute: 13 * 60,
    })
    expect(allowsStart(tuesdayMornings, { localDate: WED, startMin: at(WED, 10) }, TZ)).toBe(false)
  })

  it('agrees with the bounds the solver clips its starts to', () => {
    // Two shapes of the same arithmetic. If these ever disagree, a slot the
    // solver offered would be refused at hold time.
    const bounds = startBoundsOn(mornings, TUE, TZ)
    for (const hour of [7, 8, 9, 10, 13, 14, 18]) {
      const start = at(TUE, hour)
      const withinBounds = start >= bounds.earliest && start <= bounds.latest
      expect(allowsStart(mornings, { localDate: TUE, startMin: start }, TZ)).toBe(withinBounds)
    }
  })

  /*
   * A local wall-clock window has to resolve through the zone, not by adding a
   * fixed offset — otherwise "9am" drifts by an hour twice a year and a client
   * is silently offered 8am for six months.
   */
  it('means the same wall clock either side of a DST change', () => {
    const before = startBoundsOn(mornings, '2026-03-07', TZ) // EST
    const after = startBoundsOn(mornings, '2026-03-10', TZ) // EDT
    expect(allowsStart(mornings, { localDate: '2026-03-07', startMin: before.earliest }, TZ)).toBe(
      true,
    )
    expect(allowsStart(mornings, { localDate: '2026-03-10', startMin: after.earliest }, TZ)).toBe(
      true,
    )
    // Not a whole number of days apart, which is the entire point.
    expect((after.earliest - before.earliest) % 1440).not.toBe(0)
  })
})

describe('saying it out loud', () => {
  it('says nothing when nothing is narrowed', () => {
    expect(describeWindow(ANY_TIME)).toBeNull()
  })

  it('names a single day in the plural, the way a person would', () => {
    expect(describeWindow(window({ dayOfWeekMask: maskOf([2]) }))).toBe('Tues')
  })

  it('joins several days with an and', () => {
    expect(describeWindow(window({ dayOfWeekMask: maskOf([2, 4]) }))).toBe('Tue and Thu')
  })

  it('describes the clock as a start, not a finish', () => {
    expect(describeWindow(window({ windowStartMinute: 540, windowEndMinute: 780 }))).toBe(
      'starting between 9am and 1pm',
    )
  })

  it('combines everything into one sentence', () => {
    const text = describeWindow(
      window({
        dayOfWeekMask: maskOf([2]),
        windowStartMinute: 540,
        windowEndMinute: 780,
        latestDate: '2026-04-01',
      }),
    )
    expect(text).toBe('Tues, starting between 9am and 1pm, up to 2026-04-01')
  })
})

describe('reading a window off a row', () => {
  it('takes ServicePlan’s prefixed date columns', () => {
    const w = windowFrom({
      windowEarliestDate: new Date('2026-03-10T00:00:00Z'),
      windowLatestDate: null,
      dayOfWeekMask: maskOf([2]),
      windowStartMinute: 540,
      windowEndMinute: 780,
    })
    expect(w.earliestDate).toBe(TUE)
    expect(w.latestDate).toBeNull()
  })

  // The same function has to read WaitlistEntry, which is the whole reason the
  // column names were copied rather than invented.
  it('takes WaitlistEntry’s unprefixed ones', () => {
    const w = windowFrom({
      earliestDate: new Date('2026-03-10T00:00:00Z'),
      latestDate: new Date('2026-03-11T00:00:00Z'),
      dayOfWeekMask: EVERY_DAY,
      windowStartMinute: 0,
      windowEndMinute: 1440,
    })
    expect(w.earliestDate).toBe(TUE)
    expect(w.latestDate).toBe(WED)
    // Every day, every hour — but a waitlist entry always has a date range, so
    // it narrows by that alone.
    expect(w.dayOfWeekMask).toBe(EVERY_DAY)
    expect(isNarrowed(w)).toBe(true)
  })

  it('falls back to wide open for a row that has none of it', () => {
    expect(windowFrom({})).toEqual(ANY_TIME)
  })
})

describe('the cache signature', () => {
  it('is the same for two windows that narrow nothing', () => {
    expect(windowSignature(ANY_TIME)).toBe(windowSignature(null))
  })

  // Without this, a Tuesdays-only search would be served the answer computed
  // for an unrestricted one.
  it('differs for windows that differ', () => {
    expect(windowSignature(window({ dayOfWeekMask: maskOf([2]) }))).not.toBe(
      windowSignature(window({ dayOfWeekMask: maskOf([3]) })),
    )
    expect(windowSignature(window({ windowStartMinute: 540 }))).not.toBe(
      windowSignature(window({ windowStartMinute: 600 })),
    )
  })
})
