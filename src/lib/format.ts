/**
 * Display formatting.
 *
 * A plain module, deliberately not marked `'use client'`. Server components
 * cannot call a function exported from a client module — the import resolves to
 * a client reference and calling it throws at render time — so shared helpers
 * like these have to live somewhere neither side owns. That mistake produces a
 * blank "server-side exception" page with no useful stack, which is why the
 * boundary is worth stating out loud.
 */

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

/** Long form, for prose: "3 hours", "1h 45m". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins} minutes`
  if (mins === 0) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${hours}h ${mins}m`
}

/** Short form, for figures and tables: "3h", "1h 45m", "—" for nothing. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '—'
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  })
    .format(new Date(iso))
    .replace(/\s?([ap])m/i, (_, meridiem: string) => `${meridiem.toLowerCase()}m`)
}

export function formatDayHeading(localDate: string, timeZone: string): string {
  // Midday, so re-zoning cannot slip the date across a boundary.
  const date = new Date(`${localDate}T12:00:00Z`)
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(date)
}

/** The YYYY-MM-DD the salon is currently having, not the server's. */
export function localDateIn(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(at)
}

export function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
