/**
 * Working out what a column is.
 *
 * Four platforms, a dozen locales and every owner who has ever renamed a
 * spreadsheet header. "Mobile", "Cell", "Phone Number", "Tel", "Client Phone"
 * and "phone_number" are all the same column, and a migration that makes an
 * owner map thirty of those by hand is a migration they abandon.
 *
 * So: match on a normalised form of the header, against a list of things each
 * field is actually called. Confidence is reported rather than hidden, because
 * the import screen shows a low-confidence guess for confirmation and applies a
 * certain one silently — and the difference between those two behaviours is the
 * whole reason this returns a score at all.
 *
 * Pure, and deliberately dumb. There is no fuzzy string distance here: a near
 * miss that silently maps "Stylist Notes" onto "Client Notes" is worse than a
 * miss the owner has to resolve, because the owner will never find it again.
 */

/** Every field the importer knows how to fill. */
export type ImportField =
  // Client
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'clientNotes'
  | 'clientSince'
  // Appointment
  | 'appointmentDate'
  | 'appointmentTime'
  | 'serviceName'
  | 'stylistName'
  | 'durationMin'
  | 'priceCents'
  | 'appointmentStatus'
  | 'appointmentNotes'
  // Formula
  | 'formulaText'

export interface ColumnMatch {
  field: ImportField
  header: string
  index: number
  /**
   * 1 for an exact known alias; below 1 for a contained one.
   *
   * A contained match scores by how much of the header the alias explains,
   * which is the only thing that separates two of them. "Client Email Address"
   * contains both `client` (a name) and `clientemail` (an email), and a flat
   * score for both leaves the winner to declaration order — which is how a
   * column of email addresses ends up in the name field.
   */
  confidence: number
}

/** What each field is called in the wild. Sorted longest-first below. */
const ALIASES: Record<ImportField, readonly string[]> = {
  fullName: ['clientname', 'customername', 'fullname', 'name', 'client', 'customer'],
  firstName: ['firstname', 'givenname', 'forename', 'first'],
  lastName: ['lastname', 'surname', 'familyname', 'last'],
  email: ['clientemail', 'customeremail', 'emailaddress', 'email', 'mail'],
  phone: [
    'clientphone',
    'customerphone',
    'mobilephone',
    'phonenumber',
    'mobilenumber',
    'cellphone',
    'mobile',
    'phone',
    'cell',
    'tel',
    'telephone',
    'contactnumber',
  ],
  clientNotes: ['clientnotes', 'customernotes', 'clientcomments', 'notes', 'comments'],
  clientSince: ['clientsince', 'customersince', 'datecreated', 'createdon', 'joined', 'firstvisit'],

  appointmentDate: [
    'appointmentdate',
    'bookingdate',
    'servicedate',
    'visitdate',
    'startdate',
    'date',
  ],
  appointmentTime: ['appointmenttime', 'bookingtime', 'starttime', 'time'],
  serviceName: ['servicename', 'servicetype', 'treatment', 'service', 'item', 'description'],
  stylistName: [
    'stylistname',
    'staffname',
    'employeename',
    'providername',
    // What Fresha and Square call the person who did the work.
    'teammember',
    'stylist',
    'staff',
    'employee',
    'provider',
    'technician',
    'performedby',
  ],
  durationMin: ['durationminutes', 'durationmins', 'duration', 'length', 'minutes'],
  priceCents: ['totalprice', 'saleprice', 'amountpaid', 'price', 'amount', 'total', 'cost', 'paid'],
  appointmentStatus: ['appointmentstatus', 'bookingstatus', 'status'],
  appointmentNotes: ['appointmentnotes', 'visitnotes', 'servicenotes', 'stylistnotes'],

  formulaText: ['formula', 'colourformula', 'colorformula', 'colournotes', 'colornotes', 'mix'],
}

/**
 * Fields that must never be filled by a contained match.
 *
 * "Notes" contains nothing dangerous. "Price" inside "Price Type" does — and a
 * column of the word "fixed" parsed as money produces four thousand
 * appointments worth nothing at all. These only ever match exactly.
 */
const EXACT_ONLY: ReadonlySet<ImportField> = new Set(['priceCents', 'durationMin'])

/**
 * The same aliases, longest first within each field.
 *
 * Sorted here rather than by hand, because the matching loop takes the first
 * hit and a shorter alias hiding inside a longer one must never win: `tel` sits
 * inside `telephone`, and `phone` inside `clientphone`. Hand-ordering a dozen
 * lists correctly is a thing somebody eventually gets wrong while adding an
 * alias, and the symptom — one column mapped slightly wrong — is invisible.
 */
const ALIAS_LIST: readonly (readonly [ImportField, readonly string[]])[] = (
  Object.entries(ALIASES) as [ImportField, string[]][]
).map(([field, aliases]) => [field, [...aliases].sort((a, b) => b.length - a.length)] as const)

export function normaliseHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Match every header against every field, then resolve the collisions.
 *
 * Two headers can both look like the same field — "Name" and "Client Name" in
 * one file — and the higher confidence wins. Two fields can both want one
 * header, and the more specific field wins for the same reason.
 */
export function inferColumns(headers: readonly string[]): ColumnMatch[] {
  const candidates: ColumnMatch[] = []

  for (const [index, header] of headers.entries()) {
    const normalised = normaliseHeader(header)
    if (normalised === '') continue

    for (const [field, aliases] of ALIAS_LIST) {
      for (const alias of aliases) {
        if (normalised === alias) {
          candidates.push({ field, header, index, confidence: 1 })
          break
        }
        if (!EXACT_ONLY.has(field) && normalised.includes(alias) && alias.length >= 4) {
          /*
           * How much of the header this alias explains, which is what separates
           * two contained matches on the same column. `clientemail` covers most
           * of "Client Email Address" and `client` covers a third of it — so the
           * email wins, rather than whichever field happens to be declared
           * first. Always below 1, so an exact match anywhere beats it.
           */
          const coverage = alias.length / normalised.length
          candidates.push({ field, header, index, confidence: 0.5 + 0.4 * coverage })
          break
        }
      }
    }
  }

  /*
   * One column per field, one field per column. Sorted by confidence then by
   * position, so a tie resolves to the leftmost — which is where exports put
   * the column they consider primary.
   */
  candidates.sort((a, b) => b.confidence - a.confidence || a.index - b.index)

  const byField = new Map<ImportField, ColumnMatch>()
  const takenColumns = new Set<number>()

  for (const candidate of candidates) {
    if (byField.has(candidate.field) || takenColumns.has(candidate.index)) continue
    byField.set(candidate.field, candidate)
    takenColumns.add(candidate.index)
  }

  return [...byField.values()].sort((a, b) => a.index - b.index)
}

/**
 * A known export, named.
 *
 * Not a parser each. Every one of these platforms exports a flat CSV whose
 * headers the inference above already recognises — writing four near-identical
 * parsers would be four places for the same bug. What a platform name buys is
 * the things a header cannot tell you: which way round the dates are, and what
 * that platform calls a cancelled appointment.
 */
export type SourcePlatform = 'GENERIC' | 'VAGARO' | 'SQUARE' | 'FRESHA' | 'BOOKSY'

export interface PlatformProfile {
  platform: SourcePlatform
  label: string
  /** Null means "work it out from the file", which is the honest default. */
  dateOrder: 'DMY' | 'MDY' | null
  /** What this platform calls a cancellation, lower-cased. */
  cancelledWords: readonly string[]
  noShowWords: readonly string[]
  completedWords: readonly string[]
  /** Anything worth telling the owner before they upload. */
  note: string | null
}

export const PLATFORMS: readonly PlatformProfile[] = [
  {
    platform: 'GENERIC',
    label: 'A spreadsheet',
    dateOrder: null,
    cancelledWords: ['cancelled', 'canceled', 'void'],
    noShowWords: ['no show', 'no-show', 'noshow', 'missed'],
    completedWords: ['completed', 'complete', 'done', 'closed', 'paid', 'finished'],
    note: 'Any CSV with a header row. We will show you what we worked out before anything is saved.',
  },
  {
    platform: 'VAGARO',
    label: 'Vagaro',
    // Vagaro is US-centric and exports month-first regardless of the salon's
    // own locale, which is the single most common way a Vagaro import lands
    // every appointment in the wrong month.
    dateOrder: 'MDY',
    cancelledWords: ['cancelled', 'canceled'],
    noShowWords: ['no show', 'noshow'],
    completedWords: ['completed', 'checked out', 'closed'],
    note: 'Reports → Customers and Reports → Appointments, exported as CSV.',
  },
  {
    platform: 'SQUARE',
    label: 'Square',
    dateOrder: 'MDY',
    cancelledWords: ['canceled', 'cancelled'],
    noShowWords: ['no show', 'no-show'],
    completedWords: ['completed', 'accepted'],
    note: 'Square Appointments → Reports → export. Customer Directory is a separate export.',
  },
  {
    platform: 'FRESHA',
    label: 'Fresha',
    dateOrder: 'DMY',
    cancelledWords: ['cancelled', 'canceled'],
    noShowWords: ['no show', 'no-show', 'noshow'],
    completedWords: ['completed', 'finished'],
    note: 'Analytics → Reports → Sales and Clients, exported as CSV.',
  },
  {
    platform: 'BOOKSY',
    label: 'Booksy',
    dateOrder: 'DMY',
    cancelledWords: ['cancelled', 'canceled'],
    noShowWords: ['no show', 'noshow', 'no-show'],
    completedWords: ['completed', 'finished', 'paid'],
    note: 'Booksy exports one file per report; upload them one at a time.',
  },
]

export function platformProfile(platform: SourcePlatform): PlatformProfile {
  return PLATFORMS.find((p) => p.platform === platform) ?? PLATFORMS[0]!
}

/**
 * What this platform's status word means here.
 *
 * Anything unrecognised becomes COMPLETED, and that is the deliberate choice:
 * an imported row IS history, and the overwhelming majority of history is
 * appointments that happened. Defaulting the other way would show a salon a
 * client with forty cancellations and no visits.
 */
export function mapStatus(
  raw: string,
  profile: PlatformProfile,
): 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' {
  const value = raw.trim().toLowerCase()
  if (value === '') return 'COMPLETED'
  if (profile.noShowWords.some((word) => value.includes(word))) return 'NO_SHOW'
  if (profile.cancelledWords.some((word) => value.includes(word))) return 'CANCELLED'
  return 'COMPLETED'
}
