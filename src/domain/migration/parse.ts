import { parseCsv, toRecords } from './csv'
import {
  inferColumns,
  mapStatus,
  platformProfile,
  type ColumnMatch,
  type ImportField,
  type SourcePlatform,
} from './columns'
import {
  parseDate,
  parseDurationMin,
  parseEmail,
  parseMoneyCents,
  parseName,
  parsePhone,
  parseTimeOfDay,
  sniffDateOrder,
  type DateOrder,
} from './normalise'

/**
 * A file, turned into rows this platform understands.
 *
 * One intermediate shape for every source, which is the whole architecture: a
 * per-platform parser would be four places for the same date bug, and the
 * headers are already recognisable. What varies between platforms is date order
 * and status vocabulary, and both are data rather than code.
 *
 * Nothing here touches a database, a clock or a random number. A salon's whole
 * history goes through this function once, and when it comes out wrong the
 * question is always "which row" — so every row carries its own line number and
 * its own list of what could not be read.
 */

export interface RawImportRow {
  /** 1-based, counting the header as line 1, so it matches what Excel shows. */
  line: number

  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  clientNotes: string | null

  /** Local calendar date. Never an instant — the scheduler resolves the zone. */
  appointmentDate: string | null
  /** Minutes from local midnight. */
  appointmentTimeMin: number | null
  serviceName: string | null
  stylistName: string | null
  durationMin: number | null
  priceCents: number | null
  status: 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | null
  appointmentNotes: string | null
  formulaText: string | null

  /**
   * What could not be read on this row, in the owner's language.
   *
   * A row with problems is still returned. Dropping it would hide the fact
   * that four hundred phone numbers failed, and an import that silently loses
   * a tenth of a salon's clients is the worst possible outcome — worse than one
   * that refuses.
   */
  problems: string[]
}

export interface ParseResult {
  rows: RawImportRow[]
  /** What each column was taken to mean, for the review screen to show. */
  columns: ColumnMatch[]
  /** Headers nothing recognised. Shown, never silently dropped. */
  unmappedHeaders: string[]
  dateOrder: DateOrder
  /**
   * True when the file's dates could genuinely be read either way round.
   *
   * The single most consequential ambiguity in a migration, and the one thing
   * the importer must ask about rather than decide: every date in a file of
   * 03/04, 05/06, 07/08 is a coin flip, and getting it wrong moves a salon's
   * entire history by up to eleven months.
   */
  dateOrderAmbiguous: boolean
  /** Distinct service names, for the one-decision-per-name mapping step. */
  serviceNames: string[]
  /** Distinct stylist names, for the same reason. */
  stylistNames: string[]
}

export interface ParseOptions {
  platform?: SourcePlatform
  /** Overrides everything, for when the owner has answered the question. */
  dateOrder?: DateOrder
  /**
   * The salon's country calling code, for turning national numbers into E.164.
   *
   * Required rather than defaulted: assuming +1 is how a British salon's entire
   * client list becomes unreachable by SMS.
   */
  defaultCallingCode?: string | null
}

const MISSING = ''

export function parseImport(text: string, options: ParseOptions = {}): ParseResult {
  const profile = platformProfile(options.platform ?? 'GENERIC')
  const table = parseCsv(text)
  const records = toRecords(table)
  const columns = inferColumns(table.header)

  const mapped = new Map<ImportField, string>(
    columns.map((column) => [column.field, column.header]),
  )
  const read = (record: Record<string, string>, field: ImportField): string => {
    const header = mapped.get(field)
    return header ? (record[header] ?? MISSING) : MISSING
  }

  /*
   * Date order, decided once from the whole column.
   *
   * A single value cannot resolve 03/04/2024, but a column usually can — one
   * row with a 13th proves the file is day-first. The platform's own habit is
   * the fallback, and only when neither settles it is the caller told to ask.
   */
  const dateValues = records.map((record) => read(record, 'appointmentDate'))
  const sniffed = sniffDateOrder(dateValues)
  const dateOrder: DateOrder = options.dateOrder ?? sniffed ?? profile.dateOrder ?? 'DMY'
  const dateOrderAmbiguous =
    options.dateOrder == null && sniffed == null && dateValues.some((v) => v.trim() !== '')

  const rows = records.map((record, index): RawImportRow => {
    const problems: string[] = []

    const name = readName(record, read, problems)
    const rawPhone = read(record, 'phone')
    const phone = parsePhone(rawPhone, options.defaultCallingCode ?? null)
    if (rawPhone.trim() !== '' && phone === null) {
      problems.push(`Could not read the phone number "${rawPhone.trim()}".`)
    }

    const rawEmail = read(record, 'email')
    const email = parseEmail(rawEmail)
    if (rawEmail.trim() !== '' && email === null) {
      problems.push(`"${rawEmail.trim()}" does not look like an email address.`)
    }

    const rawDate = read(record, 'appointmentDate')
    const appointmentDate = parseDate(rawDate, dateOrder)
    if (rawDate.trim() !== '' && appointmentDate === null) {
      problems.push(`Could not read the date "${rawDate.trim()}".`)
    }

    const rawPrice = read(record, 'priceCents')
    const priceCents = parseMoneyCents(rawPrice)
    if (rawPrice.trim() !== '' && priceCents === null) {
      problems.push(`Could not read the price "${rawPrice.trim()}".`)
    }

    /*
     * A time nobody could read is recorded HERE, not at commit.
     *
     * `summarise` counts `problems` off these rows and the review screen shows
     * the count, so a problem pushed anywhere later is a problem nobody is ever
     * told about — which is exactly what happened when this lived in the
     * importer: the count had already been snapshotted, the array was discarded
     * with the parse, and the comment claiming it "says so" was simply false.
     */
    const rawTime = read(record, 'appointmentTime')
    const appointmentTimeMin = parseTimeOfDay(rawTime)
    if (rawDate.trim() !== '' && appointmentTimeMin === null) {
      problems.push(
        rawTime.trim() === ''
          ? 'No time on this row — it will import at 9am.'
          : `Could not read the time "${rawTime.trim()}" — it will import at 9am.`,
      )
    }

    const rawStatus = read(record, 'appointmentStatus')

    return {
      // The header is line 1, so the first data row is line 2 — which is what
      // the owner sees when they open the file to check.
      line: index + 2,
      firstName: name?.firstName ?? null,
      lastName: name?.lastName ?? null,
      email,
      phone,
      clientNotes: blankToNull(read(record, 'clientNotes')),
      appointmentDate,
      appointmentTimeMin,
      serviceName: blankToNull(read(record, 'serviceName')),
      stylistName: blankToNull(read(record, 'stylistName')),
      durationMin: parseDurationMin(read(record, 'durationMin')),
      priceCents,
      status: appointmentDate ? mapStatus(rawStatus, profile) : null,
      appointmentNotes: blankToNull(read(record, 'appointmentNotes')),
      formulaText: blankToNull(read(record, 'formulaText')),
      problems,
    }
  })

  const mappedHeaders = new Set(columns.map((column) => column.header))

  return {
    rows,
    columns,
    unmappedHeaders: table.header.filter(
      (header) => header.trim() !== '' && !mappedHeaders.has(header),
    ),
    dateOrder,
    dateOrderAmbiguous,
    serviceNames: distinct(rows.map((row) => row.serviceName)),
    stylistNames: distinct(rows.map((row) => row.stylistName)),
  }
}

/**
 * What can be done with this file, and what is wrong with it.
 *
 * Separate from parsing because the review screen asks a different question
 * from the parser: not "what does this row say" but "should the owner press
 * the button". A file where every row is missing a name is a file somebody
 * uploaded by mistake, and saying so beats importing four thousand blanks.
 */
export interface ImportSummary {
  totalRows: number
  /** Rows with enough to create or match a client. */
  usableClients: number
  /** Rows with a date, which is what makes a row an appointment. */
  usableAppointments: number
  rowsWithProblems: number
  /** Distinct service names needing one human decision each. */
  serviceNamesToMap: number
  /** Reasons not to proceed, in the owner's language. Empty means go. */
  blockers: string[]
  /** Worth knowing, not worth stopping for. */
  warnings: string[]
}

export function summarise(result: ParseResult): ImportSummary {
  const totalRows = result.rows.length
  const usableClients = result.rows.filter(
    (row) => row.firstName !== null && (row.phone !== null || row.email !== null),
  ).length
  const usableAppointments = result.rows.filter((row) => row.appointmentDate !== null).length
  const rowsWithProblems = result.rows.filter((row) => row.problems.length > 0).length

  const blockers: string[] = []
  const warnings: string[] = []

  if (totalRows === 0) {
    blockers.push('There are no rows in this file below the header.')
  }
  if (totalRows > 0 && usableClients === 0 && usableAppointments === 0) {
    blockers.push(
      'Nothing in this file looks like a client or an appointment. Check you exported the right report.',
    )
  }
  if (result.dateOrderAmbiguous) {
    blockers.push(
      'The dates in this file could be day-first or month-first and nothing in it settles which. Tell us which, or a year of history lands in the wrong months.',
    )
  }

  if (totalRows > 0 && usableClients < totalRows / 2 && usableClients > 0) {
    warnings.push(
      `Only ${usableClients} of ${totalRows} rows have a name and a way to contact them. The rest will import as history without a contactable client.`,
    )
  }
  if (result.unmappedHeaders.length > 0) {
    warnings.push(
      `We did not recognise ${result.unmappedHeaders.length} column${
        result.unmappedHeaders.length === 1 ? '' : 's'
      }: ${result.unmappedHeaders.join(', ')}. Nothing in them will be imported.`,
    )
  }
  if (rowsWithProblems > 0) {
    warnings.push(
      `${rowsWithProblems} row${rowsWithProblems === 1 ? ' has' : 's have'} something we could not read. They will still import, without that field.`,
    )
  }

  return {
    totalRows,
    usableClients,
    usableAppointments,
    rowsWithProblems,
    serviceNamesToMap: result.serviceNames.length,
    blockers,
    warnings,
  }
}

// --- internals --------------------------------------------------------------

function readName(
  record: Record<string, string>,
  read: (record: Record<string, string>, field: ImportField) => string,
  problems: string[],
): { firstName: string; lastName: string | null } | null {
  /*
   * Separate columns beat a combined one when both exist. An export with
   * "First", "Last" AND "Name" is common, and splitting the combined field
   * would throw away the one the exporter was sure about.
   */
  const first = read(record, 'firstName').trim()
  const last = read(record, 'lastName').trim()
  if (first !== '') return { firstName: first, lastName: last === '' ? null : last }

  const full = read(record, 'fullName')
  const parsed = parseName(full)
  if (parsed) return parsed

  if (full.trim() === '' && last === '') return null
  // A surname with no forename is still a person the salon knows.
  if (last !== '') return { firstName: last, lastName: null }

  problems.push('No name on this row.')
  return null
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function distinct(values: readonly (string | null)[]): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    if (value !== null && value.trim() !== '') seen.add(value.trim())
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}
