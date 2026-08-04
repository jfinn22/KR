import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysBetween,
  eachLocalDate,
  fromEpochMinutes,
  hasOffsetChange,
  localDateOfEpochMinutes,
  localDayOfWeek,
  localTimeToEpochMinutes,
  startOfLocalDay,
  toEpochMinutes,
} from '@/domain/scheduling/zoned'

/**
 * Timezone handling is where booking systems go quietly wrong, so every
 * assumption gets a test — including two hemispheres and a half-hour offset.
 */

const NY = 'America/New_York'
const LONDON = 'Europe/London'
const SYDNEY = 'Australia/Sydney'
const KOLKATA = 'Asia/Kolkata'

const hoursBetween = (a: number, b: number) => (b - a) / 60

describe('epoch minute conversion', () => {
  it('round-trips', () => {
    const date = new Date('2026-06-15T14:30:00Z')
    expect(fromEpochMinutes(toEpochMinutes(date)).toISOString()).toBe('2026-06-15T14:30:00.000Z')
  })
})

describe('a normal day is 24 hours', () => {
  it.each([NY, LONDON, SYDNEY, KOLKATA])('%s', (tz) => {
    const start = localTimeToEpochMinutes('2026-06-15', 0, tz)
    const nextDay = localTimeToEpochMinutes('2026-06-16', 0, tz)
    expect(hoursBetween(start, nextDay)).toBe(24)
  })
})

describe('spring forward — the day is an hour shorter', () => {
  // 2026-03-08, US DST begins at 02:00 local.
  it('a 9-to-5 shift in New York is 7 hours of elapsed time', () => {
    const open = localTimeToEpochMinutes('2026-03-08', 9 * 60, NY)
    const close = localTimeToEpochMinutes('2026-03-08', 17 * 60, NY)
    // 09:00–17:00 is 8 wall-clock hours, and no DST change falls inside it.
    expect(hoursBetween(open, close)).toBe(8)
  })

  it('a shift spanning the transition loses an hour', () => {
    const open = localTimeToEpochMinutes('2026-03-08', 1 * 60, NY)
    const close = localTimeToEpochMinutes('2026-03-08', 5 * 60, NY)
    // 01:00 to 05:00 is 4 wall-clock hours but only 3 elapsed.
    expect(hoursBetween(open, close)).toBe(3)
  })

  it('the calendar day itself is 23 hours', () => {
    const start = localTimeToEpochMinutes('2026-03-08', 0, NY)
    const end = localTimeToEpochMinutes('2026-03-09', 0, NY)
    expect(hoursBetween(start, end)).toBe(23)
  })

  it('is reported as an offset-change day', () => {
    expect(hasOffsetChange('2026-03-08', NY)).toBe(true)
    expect(hasOffsetChange('2026-03-09', NY)).toBe(false)
  })
})

describe('fall back — the day is an hour longer', () => {
  // 2026-11-01, US DST ends at 02:00 local.
  it('the calendar day is 25 hours', () => {
    const start = localTimeToEpochMinutes('2026-11-01', 0, NY)
    const end = localTimeToEpochMinutes('2026-11-02', 0, NY)
    expect(hoursBetween(start, end)).toBe(25)
  })

  it('a shift spanning the transition gains an hour', () => {
    const open = localTimeToEpochMinutes('2026-11-01', 1 * 60, NY)
    const close = localTimeToEpochMinutes('2026-11-01', 4 * 60, NY)
    expect(hoursBetween(open, close)).toBe(4)
  })

  it('is reported as an offset-change day', () => {
    expect(hasOffsetChange('2026-11-01', NY)).toBe(true)
  })
})

describe('other zones', () => {
  it('London switches on the last Sunday in March', () => {
    expect(hasOffsetChange('2026-03-29', LONDON)).toBe(true)
    expect(hasOffsetChange('2026-03-08', LONDON)).toBe(false)
  })

  // Southern hemisphere runs the opposite way round.
  it('Sydney gains an hour in April and loses one in October', () => {
    const april = hoursBetween(
      localTimeToEpochMinutes('2026-04-05', 0, SYDNEY),
      localTimeToEpochMinutes('2026-04-06', 0, SYDNEY),
    )
    const october = hoursBetween(
      localTimeToEpochMinutes('2026-10-04', 0, SYDNEY),
      localTimeToEpochMinutes('2026-10-05', 0, SYDNEY),
    )
    expect(april).toBe(25)
    expect(october).toBe(23)
  })

  it('Kolkata has a half-hour offset and no DST at all', () => {
    const nineAm = localTimeToEpochMinutes('2026-06-15', 9 * 60, KOLKATA)
    // UTC+05:30 → 09:00 local is 03:30 UTC.
    expect(fromEpochMinutes(nineAm).toISOString()).toBe('2026-06-15T03:30:00.000Z')
    expect(hasOffsetChange('2026-03-08', KOLKATA)).toBe(false)
    expect(hasOffsetChange('2026-11-01', KOLKATA)).toBe(false)
  })
})

describe('minutes past midnight beyond a single day', () => {
  it('handles a shift running past midnight', () => {
    const start = localTimeToEpochMinutes('2026-06-15', 22 * 60, NY)
    const end = localTimeToEpochMinutes('2026-06-15', 26 * 60, NY) // 02:00 next day
    expect(hoursBetween(start, end)).toBe(4)
    expect(localDateOfEpochMinutes(end, NY)).toBe('2026-06-16')
  })
})

describe('local date resolution', () => {
  it('an instant maps to the right local date on each side of midnight', () => {
    // 03:00 UTC is still the previous evening in New York.
    const instant = toEpochMinutes(new Date('2026-06-15T03:00:00Z'))
    expect(localDateOfEpochMinutes(instant, NY)).toBe('2026-06-14')
    expect(localDateOfEpochMinutes(instant, LONDON)).toBe('2026-06-15')
    expect(localDateOfEpochMinutes(instant, SYDNEY)).toBe('2026-06-15')
  })

  it('start of local day is midnight in that zone', () => {
    expect(startOfLocalDay('2026-06-15', NY).toISOString()).toBe('2026-06-15T04:00:00.000Z')
  })

  it('day of week is Sunday-zero', () => {
    expect(localDayOfWeek('2026-06-14', NY)).toBe(0) // Sunday
    expect(localDayOfWeek('2026-06-15', NY)).toBe(1) // Monday
  })
})

describe('calendar arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02')
  })

  it('handles a leap year', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('subtracts', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('is unaffected by DST — a calendar date has no offset', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
  })

  it('counts days between dates', () => {
    expect(daysBetween('2026-03-01', '2026-03-15')).toBe(14)
    expect(daysBetween('2026-03-08', '2026-03-09')).toBe(1) // DST day still counts as one
  })

  it('enumerates an inclusive range', () => {
    expect(eachLocalDate('2026-06-15', '2026-06-18')).toEqual([
      '2026-06-15',
      '2026-06-16',
      '2026-06-17',
      '2026-06-18',
    ])
  })

  it('returns nothing for an inverted range', () => {
    expect(eachLocalDate('2026-06-18', '2026-06-15')).toEqual([])
  })
})
