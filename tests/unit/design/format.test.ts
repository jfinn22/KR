import { describe, expect, it } from 'vitest'
import { formatMinuteOfDay } from '@/lib/format'

/**
 * The diary's time gutter is a minute-of-day, not an instant, so it cannot go
 * through `formatTime` — there is no date to zone. It rendered `07:00` while
 * every appointment block beside it rendered `2:15pm`, which is the one place
 * the product spoke two dialects of the same clock.
 */

describe('formatMinuteOfDay', () => {
  it('renders the salon working day the way a person says it', () => {
    expect(formatMinuteOfDay(7 * 60)).toBe('7am')
    expect(formatMinuteOfDay(9 * 60)).toBe('9am')
    expect(formatMinuteOfDay(14 * 60)).toBe('2pm')
    expect(formatMinuteOfDay(19 * 60)).toBe('7pm')
    expect(formatMinuteOfDay(21 * 60)).toBe('9pm')
  })

  it('keeps minutes when there are any', () => {
    expect(formatMinuteOfDay(14 * 60 + 15)).toBe('2:15pm')
    expect(formatMinuteOfDay(9 * 60 + 5)).toBe('9:05am')
  })

  // Both noon and midnight are hour 12 on a 12-hour clock, and both are the
  // easy ones to get wrong — 0 naively maps to "0am" and 12 to "12am".
  it('gets noon and midnight right', () => {
    expect(formatMinuteOfDay(0)).toBe('12am')
    expect(formatMinuteOfDay(12 * 60)).toBe('12pm')
    expect(formatMinuteOfDay(12 * 60 + 30)).toBe('12:30pm')
  })

  it('wraps rather than producing a nonsense hour', () => {
    expect(formatMinuteOfDay(1440)).toBe('12am')
    expect(formatMinuteOfDay(1500)).toBe('1am')
    expect(formatMinuteOfDay(-60)).toBe('11pm')
  })

  it('agrees with formatTime on the meridiem it prints', () => {
    // Same dialect, no space and lowercase — the disagreement this replaced
    // was a second formatter that emitted "2:00 pm".
    expect(formatMinuteOfDay(14 * 60 + 15)).not.toContain(' ')
    expect(formatMinuteOfDay(14 * 60)).toMatch(/[ap]m$/)
  })
})
