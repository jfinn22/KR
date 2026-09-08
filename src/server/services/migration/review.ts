import { dbFor } from '@/server/db/tenant-client'
import { storagePort } from '@/ports/registry'
import { DomainError } from '@/server/errors'
import { normaliseHeader, PLATFORMS, type SourcePlatform } from '@/domain/migration/columns'
import { callingCodeForTimeZone } from '@/domain/migration/calling-code'
import {
  parseImport,
  summarise,
  type ImportSummary,
  type ParseResult,
} from '@/domain/migration/parse'
import type { DateOrder } from '@/domain/migration/normalise'

/**
 * What the file says, before anything is written.
 *
 * Owners do not trust a single "Migrate now" button, and they are right not to
 * — a black box that eats their entire history and reports "done" is a scary
 * thing to press. So this is the screen that shows the work: what each column
 * was taken to mean, what could not be read and on which line, and every name
 * in the file that needs one decision.
 *
 * Nothing here writes. The file is re-read and re-parsed on every visit rather
 * than cached, because the alternative is a review screen that describes a
 * parse the commit will not repeat.
 */

/** A name in the file, and the row here it most likely means. */
export interface NameMatch {
  /** Exactly as the file spells it. */
  name: string
  /** Our id, when the names match outright. Null means the owner must choose. */
  suggestedId: string | null
  /** How many rows carry this name, so the biggest decisions sort first. */
  rows: number
}

export interface ImportReview {
  batch: {
    id: string
    filename: string
    status: string
    sourcePlatform: SourcePlatform
    locationId: string
    createdAt: Date
    completedAt: Date | null
    undoneAt: Date | null
    countsJson: unknown
  }
  parsed: ParseResult
  summary: ImportSummary
  /** The first few rows, as read. Seeing three real rows settles more doubt
   * than any amount of column-mapping UI. */
  sample: ParseResult['rows']
  services: NameMatch[]
  stylists: NameMatch[]
  /** Everything the salon has to map onto. */
  salonServices: { id: string; name: string }[]
  salonStylists: { id: string; displayName: string }[]
  /**
   * The dialling code the sample rows were read with.
   *
   * Guessed from the location's own timezone and shown in an editable field.
   * Without it every national number in the file renders as "could not read",
   * which tells an owner the platform is broken rather than that it has one
   * question.
   */
  defaultCallingCode: string
}

export interface ReviewOptions {
  dateOrder?: DateOrder
  defaultCallingCode?: string | null
}

export async function importReview(
  salonId: string,
  batchId: string,
  options: ReviewOptions = {},
): Promise<ImportReview> {
  const db = dbFor(salonId)
  const batch = await db.importBatch.findFirst({
    where: { id: batchId, salonId },
    include: { location: { select: { timezone: true } } },
  })
  if (!batch) throw new DomainError('NOT_FOUND', 'That import is not here.')

  const text = await sourceTextOf(batch.sourceAssetKey)
  const stored = (batch.optionsJson ?? {}) as ReviewOptions
  const callingCode =
    options.defaultCallingCode ??
    stored.defaultCallingCode ??
    callingCodeForTimeZone(batch.location.timezone)

  const parsed = parseImport(text, {
    platform: batch.sourcePlatform,
    dateOrder: options.dateOrder ?? stored.dateOrder,
    defaultCallingCode: callingCode,
  })

  const [salonServices, salonStylists] = await Promise.all([
    db.service.findMany({
      where: { salonId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    db.stylistProfile.findMany({
      where: { salonId, isActive: true },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    }),
  ])

  return {
    batch: {
      id: batch.id,
      filename: batch.filename,
      status: batch.status,
      sourcePlatform: batch.sourcePlatform,
      locationId: batch.locationId,
      createdAt: batch.createdAt,
      completedAt: batch.completedAt,
      undoneAt: batch.undoneAt,
      countsJson: batch.countsJson,
    },
    parsed,
    summary: summarise(parsed),
    sample: parsed.rows.slice(0, 5),
    services: matchNames(
      parsed.serviceNames,
      parsed.rows.map((row) => row.serviceName),
      salonServices.map((service) => ({ id: service.id, label: service.name })),
    ),
    stylists: matchNames(
      parsed.stylistNames,
      parsed.rows.map((row) => row.stylistName),
      salonStylists.map((stylist) => ({ id: stylist.id, label: stylist.displayName })),
    ),
    salonServices,
    salonStylists,
    defaultCallingCode: callingCode ?? '',
  }
}

/** Every import this salon has run, newest first. */
export async function importHistory(salonId: string) {
  const db = dbFor(salonId)
  return db.importBatch.findMany({
    where: { salonId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: {
      id: true,
      filename: true,
      status: true,
      sourcePlatform: true,
      countsJson: true,
      createdAt: true,
      completedAt: true,
      undoneAt: true,
      sourceDeletedAt: true,
    },
  })
}

export const PLATFORM_CHOICES = PLATFORMS.map((profile) => ({
  value: profile.platform,
  label: profile.label,
  note: profile.note,
}))

/**
 * Read the uploaded file back.
 *
 * Its absence is a real state rather than an error to swallow: once a batch is
 * finished the file is deleted on a timer, and a completed import whose source
 * has aged out should still show its result rather than a stack trace.
 */
export async function sourceTextOf(key: string | null): Promise<string> {
  if (!key) {
    throw new DomainError(
      'CONFLICT',
      'The uploaded file for this import has been deleted. Upload it again to run it.',
    )
  }
  const bytes = await storagePort().get(key)
  if (!bytes) {
    throw new DomainError('NOT_FOUND', 'The uploaded file for this import is no longer stored.')
  }
  return bytes.toString('utf8')
}

/**
 * Store the raw upload.
 *
 * Keyed by batch, under the salon, so the reaper can find it and nothing else
 * can guess it. Deliberately outside `dbFor` — this touches object storage,
 * not a table.
 */
export async function storeSource(salonId: string, batchId: string, text: string): Promise<string> {
  const key = `imports/${salonId}/${batchId}.csv`
  await storagePort().put({
    key,
    body: Buffer.from(text, 'utf8'),
    contentType: 'text/csv',
    // Nothing to strip, and running the JPEG marker walk over a CSV is only a
    // way to be surprised.
    stripExif: false,
  })
  return key
}

/** Remember what the owner answered, so the commit parses the same file the
 * review screen showed them. */
export async function rememberOptions(
  salonId: string,
  batchId: string,
  options: ReviewOptions,
): Promise<void> {
  const db = dbFor(salonId)
  /*
   * Only a batch that has not run yet.
   *
   * Without the status guard this quietly resurrects a COMPLETED batch back to
   * REVIEWING — and `commitBatch`'s "that import has already been run" refusal
   * then passes, so a salon's whole history imports a second time. The commit
   * action calls this immediately before committing, which is exactly where
   * that would have happened.
   */
  await db.importBatch.updateMany({
    where: { id: batchId, salonId, status: { in: ['PENDING', 'REVIEWING'] } },
    data: { optionsJson: options as object, status: 'REVIEWING' },
  })
}

// --- internals --------------------------------------------------------------

/**
 * Line the file's names up against the salon's own.
 *
 * Exact on the normalised form only — "Root Touch Up" finds "Root touch-up",
 * and nothing else finds anything. A near-miss that silently maps "Colour
 * correction" onto "Colour" is worse than one the owner resolves in a dropdown,
 * because the price and the duration go with it and nobody ever looks again.
 */
function matchNames(
  names: readonly string[],
  column: readonly (string | null)[],
  candidates: readonly { id: string; label: string }[],
): NameMatch[] {
  const byNormalised = new Map(candidates.map((c) => [normaliseHeader(c.label), c.id]))
  const counts = new Map<string, number>()
  for (const value of column) {
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  return names
    .map((name) => ({
      name,
      suggestedId: byNormalised.get(normaliseHeader(name)) ?? null,
      rows: counts.get(name) ?? 0,
    }))
    .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name))
}
