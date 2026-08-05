/**
 * Turning what a spreadsheet says into what the database means.
 *
 * Every function here answers the same question — "what did this person
 * actually write?" — and every one of them can return null, which is the point.
 * A migration that guesses is worse than one that asks: a wrong phone number
 * is a client who never hears from the salon again, and a wrong date is an
 * appointment in the wrong year that nobody notices until somebody does not
 * turn up.
 *
 * So the rule throughout: parse confidently where the answer is unambiguous,
 * return null where it is not, and never invent a default. The import screen
 * shows the nulls; a person decides.
 */

/**
 * The ambiguity nobody escapes: 03/04/2024.
 *
 * That is the 3rd of April to most of the world and the 4th of March to the
 * United States, and no amount of cleverness resolves a single row. It IS
 * resolvable across a whole file — if any row has a first component above 12,
 * the file is day-first — which is why dates are parsed with a hint worked out
 * from the entire column rather than one value at a time.
 */
export type DateOrder = 'DMY' | 'MDY' | 'ISO'

/**
 * Work out the order from every date in the column at once.
 *
 * `ISO` wins outright when the values look like `2024-04-03`, because that is
 * unambiguous by construction. Otherwise a single value with a first component
 * over 12 proves day-first; a single value with a SECOND component over 12
 * proves month-first. Where nothing proves either, the caller is told and the
 * import screen asks — a coin flip on four thousand appointment dates is not a
 * decision software should make quietly.
 */
export function sniffDateOrder(values: readonly string[]): DateOrder | null {
  let sawIso = false
  let sawSlashed = false

  for (const raw of values) {
    const value = raw.trim()
    if (value === '') continue

    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(value)) {
      sawIso = true
      continue
    }

    const parts = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)
    if (!parts) continue
    sawSlashed = true

    const first = Number(parts[1])
    const second = Number(parts[2])
    if (first > 12 && second <= 12) return 'DMY'
    if (second > 12 && first <= 12) return 'MDY'
  }

  if (sawIso && !sawSlashed) return 'ISO'
  // Genuinely ambiguous, or empty. The caller has to ask.
  return null
}

/**
 * A date, as a local calendar date — never an instant.
 *
 * Returns `YYYY-MM-DD` rather than a Date, because that is what the rest of
 * this platform means by a date: the scheduler resolves local dates to UTC
 * through the location's timezone, and handing it a Date constructed in the
 * server's zone is how an appointment lands on the wrong day for salons east
 * of Greenwich.
 */
export function parseDate(raw: string, order: DateOrder = 'ISO'): string | null {
  const value = raw.trim()
  if (value === '') return null

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return assemble(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const slashed = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)
  if (slashed) {
    const a = Number(slashed[1])
    const b = Number(slashed[2])
    const year = expandYear(Number(slashed[3]))
    const [day, month] = order === 'MDY' ? [b, a] : [a, b]
    return assemble(year, month, day)
  }

  /*
   * "3 April 2024" and "April 3, 2024" — common in hand-made exports and in
   * anything that has been through a Word document.
   */
  const named = value.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/)
  if (named) {
    const month = monthFromName(named[2]!)
    if (month) return assemble(Number(named[3]), month, Number(named[1]))
  }
  const namedFirst = value.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/)
  if (namedFirst) {
    const month = monthFromName(namedFirst[1]!)
    if (month) return assemble(Number(namedFirst[3]), month, Number(namedFirst[2]))
  }

  return null
}

/** Minutes from local midnight, from whatever the export called a time. */
export function parseTimeOfDay(raw: string): number | null {
  const value = raw.trim()
  if (value === '') return null

  const match = value.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([AaPp])?\.?[Mm]?\.?/)
  if (!match) return null

  let hours = Number(match[1])
  const minutes = Number(match[2])
  const meridiem = match[3]?.toLowerCase()

  if (minutes > 59) return null
  if (meridiem === 'p' && hours < 12) hours += 12
  if (meridiem === 'a' && hours === 12) hours = 0
  if (hours > 23) return null

  return hours * 60 + minutes
}

/**
 * Money, in cents, from text that might be anything.
 *
 * "$45.00", "45,00 €", "£45", "45" and "(45.00)" are all things exports
 * contain. The parenthesised form is accounting notation for a negative, which
 * on a service line means a refund — and reading it as positive would inflate
 * a salon's imported history.
 */
export function parseMoneyCents(raw: string): number | null {
  const value = raw.trim()
  if (value === '') return null

  const negative = /^\(.*\)$/.test(value) || value.trimStart().startsWith('-')
  const digits = value.replace(/[^\d.,]/g, '')
  if (digits === '') return null

  /*
   * Which separator is the decimal point.
   *
   * Whichever appears LAST, when both appear: "1.234,56" is European and
   * "1,234.56" is not. With only one separator, two digits after it means a
   * decimal and anything else means thousands — "1,234" is a thousand and
   * "1,23" is one and a bit.
   */
  const lastComma = digits.lastIndexOf(',')
  const lastDot = digits.lastIndexOf('.')

  let normalised: string
  if (lastComma >= 0 && lastDot >= 0) {
    normalised =
      lastComma > lastDot
        ? digits.replace(/\./g, '').replace(',', '.')
        : digits.replace(/,/g, '')
  } else if (lastComma >= 0) {
    normalised =
      digits.length - lastComma - 1 === 2 ? digits.replace(',', '.') : digits.replace(/,/g, '')
  } else {
    normalised = digits
  }

  const amount = Number(normalised)
  if (!Number.isFinite(amount)) return null

  const cents = Math.round(amount * 100)
  return negative ? -cents : cents
}

/**
 * A phone number, in E.164, or nothing.
 *
 * The SMS port refuses anything that is not E.164, so a number stored in any
 * other shape is a client the salon can never text — a silent failure that
 * shows up months later as "we never get reminders".
 *
 * A default country is REQUIRED rather than assumed, because assuming +1 is
 * how a British salon's entire client list becomes unreachable.
 */
export function parsePhone(raw: string, defaultCallingCode: string | null): string | null {
  const value = raw.trim()
  if (value === '') return null

  if (value.startsWith('+')) {
    const digits = value.slice(1).replace(/\D/g, '')
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  }

  const digits = value.replace(/\D/g, '')
  if (digits.length < 7) return null
  if (!defaultCallingCode) return null

  const code = defaultCallingCode.replace(/\D/g, '')
  /*
   * A caller who passes a country CODE — "GB" — rather than a calling code
   * gets nothing, not a mangled number. Stripping the letters leaves an empty
   * string, and `+` plus a national number is ten valid-looking digits
   * belonging to somebody else entirely.
   */
  if (code === '') return null

  // A national number written with its trunk prefix — 07700..., 0161... — drops
  // the leading zero when it takes a country code.
  const national = digits.replace(/^0+/, '')
  const combined = `+${code}${national}`

  return combined.length >= 9 && combined.length <= 16 ? combined : null
}

/** Lower-cased and trimmed, or nothing. Never a half-valid address. */
export function parseEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase()
  if (value === '') return null
  // Deliberately loose: the job here is to reject obvious rubbish, not to
  // adjudicate RFC 5322. A real address that this rejects is a client lost.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null
}

/**
 * A first and last name out of whatever the export gave.
 *
 * Two shapes cover almost everything: "Ada Rivera" and "Rivera, Ada". Anything
 * with more than two words keeps everything after the first word as the
 * surname, which is right for "Ada van der Berg" and wrong for a middle name —
 * and being wrong about a middle name is a cosmetic problem, while splitting a
 * two-word surname is a client who cannot find themselves.
 */
export function parseName(raw: string): { firstName: string; lastName: string | null } | null {
  const value = raw.trim().replace(/\s+/g, ' ')
  if (value === '') return null

  const comma = value.indexOf(',')
  if (comma > 0) {
    const last = value.slice(0, comma).trim()
    const first = value.slice(comma + 1).trim()
    if (first !== '') return { firstName: first, lastName: last || null }
  }

  const parts = value.split(' ')
  const first = parts.shift()!
  return { firstName: first, lastName: parts.length > 0 ? parts.join(' ') : null }
}

/** Whatever an export means by yes. */
export function parseBoolean(raw: string): boolean | null {
  const value = raw.trim().toLowerCase()
  if (value === '') return null
  if (['y', 'yes', 'true', '1', 'x', 'on'].includes(value)) return true
  if (['n', 'no', 'false', '0', 'off'].includes(value)) return false
  return null
}

/** A whole number of minutes, from "90", "90 min", "1:30" or "1h 30m". */
export function parseDurationMin(raw: string): number | null {
  const value = raw.trim().toLowerCase()
  if (value === '') return null

  const clock = value.match(/^(\d{1,2}):(\d{2})$/)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2])

  const hoursAndMinutes = value.match(/^(\d+)\s*h(?:ours?|rs?)?\s*(\d+)?\s*m?/)
  if (hoursAndMinutes) {
    return Number(hoursAndMinutes[1]) * 60 + Number(hoursAndMinutes[2] ?? 0)
  }

  const plain = value.match(/^(\d+)/)
  return plain ? Number(plain[1]) : null
}

// --- internals --------------------------------------------------------------

function assemble(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  /*
   * Reject the 31st of February rather than letting it roll into March. A
   * rolled date is a real-looking appointment on a day it never happened, which
   * is worse than a row the owner has to look at.
   */
  if (day > daysIn(year, month)) return null
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}

function daysIn(year: number, month: number): number {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/**
 * A two-digit year, resolved the only way that makes sense for salon history.
 *
 * Everything imported is in the past or the near future, so 24 is 2024 and 98
 * is 1998. The pivot sits at 70 because a client's date of birth can genuinely
 * be in the nineteen-hundreds and an appointment cannot.
 */
function expandYear(year: number): number {
  if (year >= 1000) return year
  return year < 70 ? 2000 + year : 1900 + year
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

function monthFromName(name: string): number | null {
  const lower = name.toLowerCase()
  const index = MONTHS.findIndex((month) => month.startsWith(lower.slice(0, 3)))
  return index >= 0 ? index + 1 : null
}
