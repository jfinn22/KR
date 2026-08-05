import { localDayOfWeek, localTimeToEpochMinutes } from './zoned'
import { formatMinuteOfDay } from '@/lib/format'

/**
 * "Tuesdays and Thursdays, mornings, in the next six weeks."
 *
 * One shape, one filter, two callers. A stylist narrowing a plan at approval
 * and a client sitting on the waitlist are saying exactly the same thing, and
 * `WaitlistEntry` already had the fields for it — `dayOfWeekMask`,
 * `windowStartMinute`, `windowEndMinute`, `earliestDate`, `latestDate` — read
 * by nothing. Modelling the plan's window differently would mean writing this
 * arithmetic twice and having the two drift, which is the specific failure
 * where a client is offered a Tuesday they said they could never do.
 *
 * Pure: no clock, no zone lookups beyond the ones `zoned.ts` owns.
 */

/** Sunday = bit 0, matching `WorkingHours.dayOfWeek` and `localDayOfWeek`. */
export const EVERY_DAY = 0b1111111

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export interface BookingWindow {
  /** Local dates, inclusive. null means "no bound at that end". */
  earliestDate: string | null
  latestDate: string | null
  dayOfWeekMask: number
  /** Minutes from local midnight. The appointment must START in this range. */
  windowStartMinute: number
  windowEndMinute: number
}

/** No narrowing at all — what a plan carries unless somebody says otherwise. */
export const ANY_TIME: BookingWindow = {
  earliestDate: null,
  latestDate: null,
  dayOfWeekMask: EVERY_DAY,
  windowStartMinute: 0,
  windowEndMinute: 1440,
}

export function dayInMask(mask: number, dayOfWeek: number): boolean {
  return (mask & (1 << dayOfWeek)) !== 0
}

export function maskOf(days: readonly number[]): number {
  return days.reduce((mask, day) => mask | (1 << day), 0)
}

export function daysOf(mask: number): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((day) => dayInMask(mask, day))
}

/** Whether this window rules anything out. A window that does not is not shown. */
export function isNarrowed(window: BookingWindow): boolean {
  return (
    window.earliestDate !== null ||
    window.latestDate !== null ||
    (window.dayOfWeekMask & EVERY_DAY) !== EVERY_DAY ||
    window.windowStartMinute > 0 ||
    window.windowEndMinute < 1440
  )
}

/**
 * Whether a whole local day is ruled out.
 *
 * Cheap enough to run before solving a day rather than after — a stylist who
 * has narrowed to Tuesdays has ruled out six sevenths of the search, and there
 * is no reason to place phases on days nobody can have.
 */
export function allowsDate(window: BookingWindow, localDate: string, timeZone: string): boolean {
  if (window.earliestDate && localDate < window.earliestDate) return false
  if (window.latestDate && localDate > window.latestDate) return false
  return dayInMask(window.dayOfWeekMask, localDayOfWeek(localDate, timeZone))
}

/**
 * The epoch-minute range an appointment on this day may START in.
 *
 * The window bounds the start, not the finish. A five-hour colour narrowed to
 * "mornings" runs into the afternoon and that is correct — the stylist asking
 * for mornings is asking to begin while the daylight is good and they are
 * fresh, not for the impossible. Bounding the finish instead would silently
 * return no slots at all for exactly the long, difficult services this
 * narrowing exists to control.
 *
 * Returned as an interval rather than a predicate because the solver needs to
 * clip its candidate starts before generating them, and a solver that filtered
 * afterwards would spend its per-day cap on times it was about to discard. The
 * predicate below is the same arithmetic, so the two cannot disagree.
 */
export function startBoundsOn(
  window: BookingWindow,
  localDate: string,
  timeZone: string,
): { earliest: number; latest: number } {
  const midnight = localTimeToEpochMinutes(localDate, 0, timeZone)
  return {
    earliest: midnight + window.windowStartMinute,
    latest: midnight + window.windowEndMinute,
  }
}

/** Whether an appointment may START here. */
export function allowsStart(
  window: BookingWindow,
  slot: { localDate: string; startMin: number },
  timeZone: string,
): boolean {
  if (!allowsDate(window, slot.localDate, timeZone)) return false

  const { earliest, latest } = startBoundsOn(window, slot.localDate, timeZone)
  return slot.startMin >= earliest && slot.startMin <= latest
}

/**
 * The window in the words it would be said in.
 *
 * Shown to the client on the booking screen, because "no times in that range"
 * is infuriating when the reason is a restriction somebody else applied and
 * nobody mentioned.
 */
export function describeWindow(window: BookingWindow): string | null {
  if (!isNarrowed(window)) return null

  const parts: string[] = []

  const days = daysOf(window.dayOfWeekMask)
  if (days.length === 0) parts.push('no days')
  else if (days.length < 7) {
    const named = days.map((d) => DAY_LABELS[d]!)
    parts.push(
      named.length === 1 ? `${named[0]}s` : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`,
    )
  }

  if (window.windowStartMinute > 0 || window.windowEndMinute < 1440) {
    parts.push(
      `starting between ${formatMinuteOfDay(window.windowStartMinute)} and ${formatMinuteOfDay(window.windowEndMinute)}`,
    )
  }

  if (window.earliestDate && window.latestDate) {
    parts.push(`between ${window.earliestDate} and ${window.latestDate}`)
  } else if (window.earliestDate) {
    parts.push(`from ${window.earliestDate}`)
  } else if (window.latestDate) {
    parts.push(`up to ${window.latestDate}`)
  }

  return parts.join(', ')
}

/** A stable key for caching. Two windows that differ must not share an answer. */
export function windowSignature(window: BookingWindow | null | undefined): string {
  if (!window || !isNarrowed(window)) return '-'
  return [
    window.earliestDate ?? '',
    window.latestDate ?? '',
    window.dayOfWeekMask,
    window.windowStartMinute,
    window.windowEndMinute,
  ].join('/')
}

/**
 * Read a window off a row that carries the five fields.
 *
 * `ServicePlan` and `WaitlistEntry` both do, with the same names and the same
 * meanings, which is the entire point of having copied the shape.
 */
export function windowFrom(row: {
  windowEarliestDate?: Date | string | null
  windowLatestDate?: Date | string | null
  earliestDate?: Date | string | null
  latestDate?: Date | string | null
  dayOfWeekMask?: number | null
  windowStartMinute?: number | null
  windowEndMinute?: number | null
}): BookingWindow {
  const asDate = (value: Date | string | null | undefined): string | null =>
    value == null ? null : typeof value === 'string' ? value : value.toISOString().slice(0, 10)

  return {
    earliestDate: asDate(row.windowEarliestDate ?? row.earliestDate),
    latestDate: asDate(row.windowLatestDate ?? row.latestDate),
    dayOfWeekMask: row.dayOfWeekMask ?? EVERY_DAY,
    windowStartMinute: row.windowStartMinute ?? 0,
    windowEndMinute: row.windowEndMinute ?? 1440,
  }
}
