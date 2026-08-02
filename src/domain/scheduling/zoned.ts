import { fromZonedTime, toZonedTime, formatInTimeZone } from 'date-fns-tz'

/**
 * The ONLY place local time becomes UTC, or the reverse.
 *
 * Everything else in the scheduling domain works in epoch minutes. Salons think
 * in "Tuesday, 9am to 5pm"; the database stores instants. Getting that boundary
 * wrong is the classic booking-system bug, and confining it to one tested module
 * is the mitigation.
 *
 * The rule that matters: a local wall-clock time resolves through the IANA zone,
 * never by adding a fixed offset. On a spring-forward day a 09:00–17:00 shift is
 * seven hours of elapsed time; on fall-back it is nine.
 */

export const MINUTE_MS = 60_000

export const toEpochMinutes = (date: Date): number => Math.floor(date.getTime() / MINUTE_MS)

export const fromEpochMinutes = (minutes: number): Date => new Date(minutes * MINUTE_MS)

/** `2026-03-08` in the given zone → the UTC instant of its midnight. */
export function startOfLocalDay(localDate: string, timeZone: string): Date {
  return fromZonedTime(`${localDate}T00:00:00`, timeZone)
}

/**
 * A wall-clock time on a local date, as epoch minutes.
 *
 * `minutesFromMidnight` may exceed 1440 for a shift running past midnight; the
 * conversion still goes through the zone, so a DST change inside the shift is
 * accounted for rather than silently absorbed.
 */
export function localTimeToEpochMinutes(
  localDate: string,
  minutesFromMidnight: number,
  timeZone: string,
): number {
  const dayOffset = Math.floor(minutesFromMidnight / 1440)
  const withinDay = minutesFromMidnight - dayOffset * 1440

  const date = dayOffset === 0 ? localDate : addDays(localDate, dayOffset)
  const hh = String(Math.floor(withinDay / 60)).padStart(2, '0')
  const mm = String(withinDay % 60).padStart(2, '0')

  return toEpochMinutes(fromZonedTime(`${date}T${hh}:${mm}:00`, timeZone))
}

/** The local calendar date an instant falls on, e.g. `2026-03-08`. */
export function localDateOf(instant: Date, timeZone: string): string {
  return formatInTimeZone(instant, timeZone, 'yyyy-MM-dd')
}

export function localDateOfEpochMinutes(minutes: number, timeZone: string): string {
  return localDateOf(fromEpochMinutes(minutes), timeZone)
}

/** 0 = Sunday, matching `WorkingHours.dayOfWeek`. */
export function localDayOfWeek(localDate: string, timeZone: string): number {
  return toZonedTime(startOfLocalDay(localDate, timeZone), timeZone).getDay()
}

export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number]
  // UTC arithmetic on a bare calendar date — no zone involved, so no DST risk.
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Every local date from `from` to `to` inclusive. */
export function eachLocalDate(from: string, to: string): string[] {
  const dates: string[] = []
  let cursor = from
  // Guard against a caller passing an inverted or absurd range.
  for (let i = 0; i < 800 && cursor <= to; i++) {
    dates.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return dates
}

export function daysBetween(from: string, to: string): number {
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number]
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((parse(to) - parse(from)) / 86_400_000)
}

/** Human-facing local time, e.g. `2:15 pm`. */
export function formatLocalTime(minutes: number, timeZone: string): string {
  return formatInTimeZone(fromEpochMinutes(minutes), timeZone, 'h:mm a').toLowerCase()
}

export function formatLocalDateTime(minutes: number, timeZone: string): string {
  return formatInTimeZone(fromEpochMinutes(minutes), timeZone, 'EEE d MMM, h:mm a')
}

/**
 * Whether a local date contains a UTC-offset change in the given zone.
 *
 * Surfaced so the front desk can be warned rather than quietly given a day that
 * is an hour shorter or longer than every other.
 */
export function hasOffsetChange(localDate: string, timeZone: string): boolean {
  const start = startOfLocalDay(localDate, timeZone)
  const nextDay = startOfLocalDay(addDays(localDate, 1), timeZone)
  const elapsedMinutes = (nextDay.getTime() - start.getTime()) / MINUTE_MS
  return elapsedMinutes !== 1440
}
