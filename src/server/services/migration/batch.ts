import type { Prisma } from '@prisma/client'
import { unsafeDb } from '@/server/db/client'
import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import { localTimeToEpochMinutes, fromEpochMinutes } from '@/domain/scheduling/zoned'
import { invalidateAvailabilityCache } from '@/server/services/scheduling/loader'
import type { RawImportRow } from '@/domain/migration/parse'
import type { SourcePlatform } from '@/domain/migration/columns'

/**
 * An import, as one undoable event.
 *
 * The owner will get the first file wrong. They will pick the wrong export,
 * or the wrong date order, or discover halfway down the review screen that
 * their old platform put the stylist's name in the notes column — and if the
 * only way back is a support ticket, they will not press the button at all.
 *
 * So every row an import writes carries `importBatchId`, and undo is a walk
 * over three columns rather than a reconstruction. That single FK is the whole
 * feature; the rest of this file is the care taken around it.
 *
 * The care that matters: **undo removes what the import created and nothing
 * that has happened since.** A client who has claimed their record or booked an
 * appointment in the meantime is kept, and named in the result, because
 * deleting them would take the new booking with them through the cascade. An
 * undo that eats a real Tuesday is a worse support ticket than the one it was
 * meant to avoid.
 */

export interface CommitOptions {
  /** File's service name -> Service id. A name absent here imports unmapped. */
  serviceMap: Readonly<Record<string, string | null>>
  /** File's stylist name -> StylistProfile id. */
  stylistMap: Readonly<Record<string, string | null>>
}

export interface BatchCounts {
  clientsCreated: number
  /** Rows that found an existing client rather than making a second one. */
  clientsMatched: number
  appointmentsCreated: number
  /** Rows with a date that could not become an appointment, and why. */
  appointmentsSkipped: number
  /** Appointments imported with no service line, because the name was unmapped. */
  appointmentsUnmappedService: number
  /**
   * Future appointments imported as real bookings, holding real chair time.
   *
   * The whole point of a parallel run: between import and go-live the old
   * system is still the system of record, and staff poke at the new one. A
   * future appointment written as a plain history row leaves this platform
   * believing that chair is free — so the parallel run causes the
   * double-booking it existed to prevent.
   */
  appointmentsBooked: number
  /** Future appointments refused because the chair was already taken. */
  appointmentsClashed: number
  rowsWithProblems: number
}

export interface KeptClient {
  id: string
  name: string
  /** Why this one survived the undo, in the owner's language. */
  reason: string
}

export interface UndoResult {
  clientsDeleted: number
  appointmentsDeleted: number
  formulasDeleted: number
  /** Named, because "we kept 4 of them" without saying which is not an answer. */
  clientsKept: KeptClient[]
}

/** A batch that has finished one way or another, and may not be touched again. */
const TERMINAL = ['COMPLETED', 'FAILED', 'UNDONE'] as const

export async function createBatch(
  salonId: string,
  input: {
    locationId: string
    filename: string
    sourcePlatform: SourcePlatform
    sourceAssetKey: string | null
    createdByUserId: string
  },
) {
  const db = dbFor(salonId)
  return db.importBatch.create({
    data: {
      salonId,
      locationId: input.locationId,
      filename: input.filename,
      sourcePlatform: input.sourcePlatform,
      sourceAssetKey: input.sourceAssetKey,
      createdByUserId: input.createdByUserId,
      status: 'PENDING',
    },
  })
}

/**
 * Write the rows.
 *
 * One transaction, so a failure halfway leaves no half-imported salon. A few
 * thousand rows is real write volume, which is why the caller runs this from
 * the job queue rather than a request — but the atomicity is not negotiable
 * even so: a partial import is indistinguishable to an owner from a broken one,
 * and they cannot tell which half arrived.
 */
export async function commitBatch(
  salonId: string,
  batchId: string,
  rows: readonly RawImportRow[],
  options: CommitOptions,
  now = new Date(),
): Promise<BatchCounts> {
  const db = dbFor(salonId)

  const batch = await db.importBatch.findFirst({
    where: { id: batchId, salonId },
    include: { location: { select: { id: true, timezone: true } } },
  })
  if (!batch) throw new DomainError('NOT_FOUND', 'That import is not here.')
  if (batch.status !== 'REVIEWING' && batch.status !== 'PENDING') {
    throw new DomainError('CONFLICT', 'That import has already been run.')
  }

  await db.importBatch.update({
    where: { id: batchId },
    data: { status: 'COMMITTING', startedAt: new Date() },
  })

  const timeZone = batch.location.timezone
  const counts: BatchCounts = {
    clientsCreated: 0,
    clientsMatched: 0,
    appointmentsCreated: 0,
    appointmentsSkipped: 0,
    appointmentsUnmappedService: 0,
    appointmentsBooked: 0,
    appointmentsClashed: 0,
    rowsWithProblems: rows.filter((row) => row.problems.length > 0).length,
  }

  try {
    await unsafeDb.$transaction(
      async (tx: Prisma.TransactionClient) => {
        /*
         * Clients first, in one pass, because the same person appears on every
         * one of their appointments. A file of four thousand appointment rows
         * is usually six hundred people.
         */
        const clientIdFor = new Map<string, string>()
        /** Every handle a row gives us, tried in turn against what we have. */
        const lookup = (row: RawImportRow): string | undefined => {
          for (const key of identityKeys(row)) {
            const found = clientIdFor.get(key)
            if (found) return found
          }
          return undefined
        }

        for (const row of rows) {
          const keys = identityKeys(row)
          if (keys.length === 0 || lookup(row)) continue

          const existing = await findExistingClient(tx, salonId, row)
          if (existing) {
            for (const key of keys) clientIdFor.set(key, existing)
            counts.clientsMatched += 1
            continue
          }

          const created = await tx.clientProfile.create({
            data: {
              salonId,
              firstName: row.firstName ?? 'Unnamed',
              /*
               * `ClientProfile.lastName` is required and plenty of people on a
               * salon's books have one name. Empty rather than a placeholder —
               * "Cher Unknown" is a worse thing to greet somebody by than
               * "Cher", and every name the platform renders is already joined
               * and trimmed.
               */
              lastName: row.lastName ?? '',
              email: row.email,
              phone: row.phone,
              internalNotes: row.clientNotes,
              source: 'IMPORT',
              importBatchId: batchId,
            },
            select: { id: true },
          })
          await writeImportedConsent(tx, salonId, created.id)
          /*
           * Registered under every handle the row gave, not just the best one.
           * A client whose phone is on one line and only their email on the
           * next would otherwise be two people — which is the single most
           * visible way an import can be wrong, and the one an owner spots on
           * the first screen.
           */
          for (const key of keys) clientIdFor.set(key, created.id)
          counts.clientsCreated += 1
        }

        for (const row of rows) {
          if (row.appointmentDate === null) continue

          const clientProfileId = lookup(row)
          const stylistProfileId = row.stylistName
            ? (options.stylistMap[row.stylistName] ?? null)
            : null

          /*
           * No client, or no stylist we can name, and the appointment does not
           * get written.
           *
           * `primaryStylistId` is not nullable, and the tempting fix — put it
           * on whoever is first in the list — writes a false attribution into
           * that stylist's own figures. This platform reports rebook rate per
           * stylist; inventing the attribution is how a stylist gets appraised
           * on somebody else's clients.
           */
          if (!clientProfileId || !stylistProfileId) {
            counts.appointmentsSkipped += 1
            continue
          }

          const serviceId = row.serviceName ? (options.serviceMap[row.serviceName] ?? null) : null
          const durationMin = row.durationMin ?? 60
          /*
           * A row with a date and no readable time still imports, at nine in
           * the morning, and says so. Refusing it would lose a real visit over
           * a column the old platform did not export; letting it through
           * silently puts a fictional time on a client's record that nobody can
           * tell from a real one.
           */
          if (row.appointmentTimeMin === null) {
            row.problems.push('No readable time on this row — imported as 9am.')
          }
          const startsAt = fromEpochMinutes(
            localTimeToEpochMinutes(row.appointmentDate, row.appointmentTimeMin ?? 9 * 60, timeZone),
          )
          const endsAt = new Date(startsAt.getTime() + durationMin * 60_000)
          const priceCents = Math.max(0, row.priceCents ?? 0)

          /*
           * Past and future are not the same import.
           *
           * History gets a plain row and no segments: a segment is a claim on a
           * stylist's time under the exclusion constraint, so importing four
           * thousand of them would let one overlap in a sloppy export fail the
           * whole migration, and would fill a diary nobody scrolls back to.
           *
           * A FUTURE appointment is a different thing entirely. It is a chair
           * somebody is expected to sit in, and without a segment this platform
           * believes that chair is free — which turns a parallel run into the
           * cause of the double-booking it was meant to prevent.
           */
          const isFuture = startsAt.getTime() > now.getTime()

          if (isFuture) {
            /*
             * Checked before the insert rather than caught after it. The
             * exclusion constraint would abort the entire transaction and take
             * four thousand good rows with it, and a clash on one Tuesday is not
             * a reason to refuse a salon's whole history.
             */
            const clash = await tx.appointmentSegment.findFirst({
              where: {
                salonId,
                stylistProfileId,
                /*
                 * The same predicate the exclusion constraint uses, exactly.
                 *
                 * `segment_stylist_no_overlap` covers state IN ('ACTIVE','HOLD')
                 * — a slot somebody is midway through booking counts. Checking
                 * only ACTIVE leaves the constraint able to fire on a live hold,
                 * and the constraint aborts the whole transaction rather than
                 * one row, so a member of staff clicking around the new system
                 * during a parallel run would take a salon's entire migration
                 * down with them.
                 */
                blocksStylist: true,
                state: { in: ['ACTIVE', 'HOLD'] },
                startsAt: { lt: endsAt },
                endsAt: { gt: startsAt },
              },
              select: { id: true },
            })
            if (clash) {
              counts.appointmentsClashed += 1
              continue
            }
          }

          /*
           * A visit that has not happened yet is not a completed one.
           *
           * `mapStatus` defaults an unrecognised or empty status column to
           * COMPLETED, which is right for history and catastrophic for the
           * future: an upcoming appointment written as COMPLETED and checked
           * out counts towards the client's visit total, reports revenue nobody
           * has taken, and — worst of all — is invisible to every upcoming-
           * appointment query in the platform, which is the one thing a
           * parallel run exists to populate.
           */
          const status = isFuture ? 'CONFIRMED' : (row.status ?? 'COMPLETED')
          const settled = status === 'COMPLETED'

          const appointment = await tx.appointment.create({
            data: {
              salonId,
              locationId: batch.locationId,
              clientProfileId,
              primaryStylistId: stylistProfileId,
              status,
              source: 'IMPORT',
              startsAt,
              endsAt,
              estimatedDurationMin: durationMin,
              estimatedTotalCents: priceCents,
              // Only money that has actually changed hands.
              actualTotalCents: settled ? priceCents : null,
              internalNote: row.appointmentNotes,
              checkedOutAt: settled ? endsAt : null,
              cancelledAt: status === 'CANCELLED' ? startsAt : null,
              noShowAt: status === 'NO_SHOW' ? startsAt : null,
              importBatchId: batchId,
            },
            select: { id: true },
          })
          counts.appointmentsCreated += 1

          if (serviceId) {
            await tx.appointmentService.create({
              data: {
                salonId,
                appointmentId: appointment.id,
                serviceId,
                stylistProfileId,
                sequence: 0,
                plannedDurationMin: durationMin,
                priceCents,
              },
            })
          } else {
            counts.appointmentsUnmappedService += 1
          }

          if (isFuture) {
            await tx.appointmentSegment.create({
              data: {
                salonId,
                locationId: batch.locationId,
                appointmentId: appointment.id,
                stylistProfileId,
                kind: 'ACTIVE',
                sequence: 0,
                startsAt,
                endsAt,
                // One block, not the real phase chain. The old platform did not
                // record where the processing was, and inventing an interleave
                // gap would sell time this salon has already promised somebody.
                blocksStylist: true,
                state: 'ACTIVE',
              },
            })
            counts.appointmentsBooked += 1
          }

          if (row.formulaText) {
            await tx.formula.create({
              data: {
                salonId,
                clientProfileId,
                appointmentId: appointment.id,
                stylistProfileId,
                purpose: 'GLOBAL_COLOR',
                // Verbatim. Somebody else's shorthand is not ours to parse into
                // components, and a wrongly-split formula is worse than one the
                // stylist has to read.
                applicationNotes: row.formulaText,
                /*
                 * When the colour went on, not when the row was written.
                 *
                 * `createdAt` defaults to now(), and left alone it would read
                 * every migrated client as having been coloured on migration
                 * day — which is the clock anything asking "how grown out is
                 * this" would use. A whole salon's regrowth would come back
                 * wrong on the morning they switched.
                 */
                createdAt: startsAt,
                importBatchId: batchId,
              },
            })
          }
        }

        /*
         * Counters last, recomputed rather than incremented.
         *
         * `completedVisits === 0` is how nine places in this platform ask "is
         * this a new client", so a migrated salon whose whole book reads as
         * first-timers would fire its new-client welcome at every client it
         * has. Recomputing from what is actually in the table — instead of
         * incrementing as rows are written — also makes undo exact: the same
         * function run afterwards gives the right answer with no rollback.
         */
        await recount(tx, salonId, [...clientIdFor.values()])
      },
      { timeout: 120_000 },
    )
  } catch (error) {
    await db.importBatch.update({
      where: { id: batchId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        problem: 'Nothing was imported — the run stopped partway and was rolled back.',
      },
    })
    throw error
  }

  await db.importBatch.update({
    where: { id: batchId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      countsJson: counts as unknown as Prisma.InputJsonValue,
    },
  })

  /*
   * The solver caches who is busy. An import that booked upcoming appointments
   * has changed exactly that, and a stale cache would offer a slot the database
   * will then refuse at hold time — the worst possible first impression of a
   * newly migrated salon.
   */
  if (counts.appointmentsBooked > 0) invalidateAvailabilityCache(salonId)

  return counts
}

/**
 * Put it back.
 *
 * Deletes every appointment and formula the batch created, and every client it
 * created that nobody has depended on since. The batch row survives as the
 * record that this happened.
 */
export async function undoBatch(
  salonId: string,
  batchId: string,
  undoneByUserId: string,
): Promise<UndoResult> {
  const db = dbFor(salonId)

  const batch = await db.importBatch.findFirst({ where: { id: batchId, salonId } })
  if (!batch) throw new DomainError('NOT_FOUND', 'That import is not here.')
  if (batch.status === 'UNDONE') {
    throw new DomainError('CONFLICT', 'That import has already been undone.')
  }
  if (batch.status === 'COMMITTING') {
    throw new DomainError('CONFLICT', 'That import is still running. Wait for it to finish.')
  }

  const clients = await db.clientProfile.findMany({
    where: { salonId, importBatchId: batchId },
    select: { id: true, firstName: true, lastName: true, userId: true },
  })
  const clientIds = clients.map((client) => client.id)

  /*
   * Everyone this batch wrote an appointment for, including clients the salon
   * already had. Their counters were raised by the import too, and recomputing
   * only the rows the import created would leave a matched client permanently
   * crediting history that no longer exists.
   */
  const touched = (
    await db.appointment.findMany({
      where: { salonId, importBatchId: batchId },
      select: { clientProfileId: true },
      distinct: ['clientProfileId'],
    })
  ).map((row) => row.clientProfileId)

  const result = await unsafeDb.$transaction(async (tx: Prisma.TransactionClient) => {
    /*
     * Who is spared is decided inside the transaction, not before it. Deciding
     * on a snapshot and acting a moment later is how a client who books in
     * between the two gets deleted by an undo that had already concluded they
     * were unused — taking their brand-new appointment with them.
     */
    const inUse = await stillInUse(tx, salonId, batchId, clientIds)

    const kept: KeptClient[] = []
    const doomed: string[] = []
    for (const client of clients) {
      const reason = client.userId
        ? 'They have signed in and claimed this record.'
        : (inUse.get(client.id) ?? null)
      if (reason) kept.push({ id: client.id, name: fullName(client), reason })
      else doomed.push(client.id)
    }

    /*
     * Formulas, then appointments, then clients — children before parents, so
     * nothing is deleted out from under a foreign key mid-transaction.
     *
     * Every imported appointment goes, including those of a client who is being
     * kept: the client is the person, and the appointments are the history this
     * import got wrong.
     */
    const formulas = await tx.formula.deleteMany({ where: { salonId, importBatchId: batchId } })
    const appointments = await tx.appointment.deleteMany({
      where: {
        salonId,
        importBatchId: batchId,
        /*
         * The same rule as for clients: undo removes what the import created
         * and nothing that has happened since.
         *
         * Status is the wrong discriminator here, because imported history is
         * COMPLETED by definition and sparing that would undo nothing at all.
         * What separates the two is whether a person did something: the import
         * never sets `chairStartedAt` and never raises an invoice, so either one
         * means a booking this import made has since been sat through or billed.
         * Deleting that takes the invoice with it through the cascade and leaves
         * the salon's takings short with nothing to explain it.
         */
        invoice: null,
        chairStartedAt: null,
      },
    })

    // Anything spared keeps its history and loses its provenance, so a second
    // sweep can never mistake it for the import's to remove.
    await tx.appointment.updateMany({
      where: { salonId, importBatchId: batchId },
      data: { importBatchId: null },
    })
    const removed = doomed.length
      ? await tx.clientProfile.deleteMany({ where: { salonId, id: { in: doomed } } })
      : { count: 0 }

    /*
     * The counters, recomputed against what is left.
     *
     * They were derived from history this undo has just deleted. Left alone a
     * kept client says "42 visits" over an empty timeline, which reads as the
     * platform having lost the data — precisely the fear undo exists to settle.
     * Everyone the batch touched is recounted, not only the ones it created:
     * a client the salon already had had their history added to as well.
     */
    await recount(tx, salonId, [...kept.map((client) => client.id), ...touched])

    await tx.importBatch.update({
      where: { id: batchId },
      data: {
        status: 'UNDONE',
        undoneAt: new Date(),
        undoneByUserId,
        // So the retention sweep can find it even if it never completed.
        completedAt: batch.completedAt ?? new Date(),
      },
    })

    return {
      clientsDeleted: removed.count,
      appointmentsDeleted: appointments.count,
      formulasDeleted: formulas.count,
      clientsKept: kept,
    }
  })

  // Chair time has been handed back; the solver has to be told.
  if (result.appointmentsDeleted > 0) invalidateAvailabilityCache(salonId)

  return result
}

/**
 * Delete the uploaded file, keeping the audit record.
 *
 * A raw export holds more contact PII in one object than the platform stores
 * anywhere else — a salon's entire client list, in the clear. Retention runs
 * from the batch reaching a terminal state rather than from upload, so a
 * stalled import is never deleted out from under an owner mid-review.
 */
export async function batchesDueForFileDeletion(
  salonId: string,
  olderThan: Date,
): Promise<{ id: string; sourceAssetKey: string }[]> {
  const db = dbFor(salonId)
  const rows = await db.importBatch.findMany({
    where: {
      salonId,
      status: { in: [...TERMINAL] },
      sourceAssetKey: { not: null },
      /*
       * Either terminal timestamp. A batch undone from a state that never set
       * `completedAt` would otherwise never match, and its raw upload — a
       * salon's whole client list in the clear — would sit in storage forever.
       */
      OR: [{ completedAt: { lt: olderThan } }, { undoneAt: { lt: olderThan } }],
    },
    select: { id: true, sourceAssetKey: true },
  })
  return rows.flatMap((row) =>
    row.sourceAssetKey ? [{ id: row.id, sourceAssetKey: row.sourceAssetKey }] : [],
  )
}

export async function markSourceDeleted(salonId: string, batchId: string): Promise<void> {
  const db = dbFor(salonId)
  await db.importBatch.updateMany({
    where: { id: batchId, salonId },
    data: { sourceAssetKey: null, sourceDeletedAt: new Date() },
  })
}

// --- internals --------------------------------------------------------------

/**
 * Whether anything has happened to these clients since the import.
 *
 * Three questions, each a single indexed query, and each one a real reason a
 * person now depends on the row: they have booked outside this import, they
 * have been consulted, or they have been billed.
 */
async function stillInUse(
  db: Prisma.TransactionClient,
  salonId: string,
  batchId: string,
  clientIds: readonly string[],
): Promise<Map<string, string>> {
  const reasons = new Map<string, string>()
  if (clientIds.length === 0) return reasons

  const ids = [...clientIds]

  const booked = await db.appointment.findMany({
    where: {
      salonId,
      clientProfileId: { in: ids },
      // Explicit rather than `not: batchId`: a row with a NULL batch is an
      // appointment somebody made by hand, which is exactly the case that
      // matters most here.
      OR: [{ importBatchId: null }, { importBatchId: { not: batchId } }],
    },
    select: { clientProfileId: true },
    distinct: ['clientProfileId'],
  })
  for (const row of booked) {
    reasons.set(row.clientProfileId, 'They have an appointment that did not come from this import.')
  }

  /*
   * And an appointment that DID come from this import but has since been sat
   * through or billed.
   *
   * Without this the client looks untouched — their only appointment still
   * carries the batch id — so they are deleted, and the visit somebody actually
   * did goes with them through the cascade. The appointment's own guard never
   * gets a chance to run.
   */
  const worked = await db.appointment.findMany({
    where: {
      salonId,
      clientProfileId: { in: ids },
      importBatchId: batchId,
      OR: [{ chairStartedAt: { not: null } }, { invoice: { isNot: null } }],
    },
    select: { clientProfileId: true },
    distinct: ['clientProfileId'],
  })
  for (const row of worked) {
    if (!reasons.has(row.clientProfileId)) {
      reasons.set(row.clientProfileId, 'They have been in since, on an appointment this import made.')
    }
  }

  const consulted = await db.consultation.findMany({
    where: { salonId, clientProfileId: { in: ids } },
    select: { clientProfileId: true },
    distinct: ['clientProfileId'],
  })
  for (const row of consulted) {
    if (!reasons.has(row.clientProfileId)) {
      reasons.set(row.clientProfileId, 'They have been through a consultation since.')
    }
  }

  const invoiced = await db.invoice.findMany({
    where: { salonId, clientProfileId: { in: ids } },
    select: { clientProfileId: true },
    distinct: ['clientProfileId'],
  })
  for (const row of invoiced) {
    if (!reasons.has(row.clientProfileId)) {
      reasons.set(row.clientProfileId, 'They have been billed since.')
    }
  }

  return reasons
}

/**
 * What an imported client has and has not agreed to.
 *
 * The decision, stated: transactional yes, marketing no.
 *
 * Transactional is defensible — these are the salon's own clients and the
 * messages are about appointments they made. Marketing is not: nobody can
 * migrate a permission they cannot evidence, and a CSV column that says "yes"
 * is somebody else's software's word for a conversation this salon cannot
 * produce. A client who wants the offers can opt in from their own account.
 *
 * Written rather than left absent, which is the part that matters. The send
 * path treats a missing row as permission for transactional messages, so an
 * imported client without rows is currently being messaged on the strength of
 * an omission rather than a decision — and there is no record afterwards of
 * which it was.
 */
async function writeImportedConsent(
  tx: Prisma.TransactionClient,
  salonId: string,
  clientProfileId: string,
): Promise<void> {
  const rows = (['SMS', 'EMAIL'] as const).flatMap((channel) => [
    { channel, purpose: 'TRANSACTIONAL' as const, status: 'GRANTED' as const },
    { channel, purpose: 'MARKETING' as const, status: 'REVOKED' as const },
  ])

  for (const row of rows) {
    await tx.contactConsent.create({
      data: {
        salonId,
        clientProfileId,
        channel: row.channel,
        purpose: row.purpose,
        status: row.status,
        capturedVia: 'IMPORT',
      },
    })
  }
}

/**
 * Rebuild a client's visit counters from the appointments that exist.
 *
 * Derived numbers, recomputed rather than nudged. An import writes history in
 * bulk and an undo takes it away in bulk, and neither is a place to be adding
 * and subtracting from a running total — one missed decrement and a client
 * carries a wrong lifetime figure forever, with nothing to compare it against.
 */
async function recount(
  tx: Prisma.TransactionClient,
  salonId: string,
  clientIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(clientIds)]
  for (const clientProfileId of unique) {
    const visits = await tx.appointment.findMany({
      where: { salonId, clientProfileId, status: 'COMPLETED' },
      select: { startsAt: true, actualTotalCents: true },
      orderBy: { startsAt: 'asc' },
    })

    await tx.clientProfile.updateMany({
      where: { salonId, id: clientProfileId },
      data: {
        completedVisits: visits.length,
        lifetimeSpendCents: visits.reduce((total, visit) => total + (visit.actualTotalCents ?? 0), 0),
        firstVisitAt: visits[0]?.startsAt ?? null,
        lastVisitAt: visits.at(-1)?.startsAt ?? null,
      },
    })
  }
}

/**
 * Match against a client the salon already has.
 *
 * Phone first, then email, both exact on the normalised form the parser
 * produced. Deliberately not fuzzy on names: a salon with two Sarah Joneses is
 * ordinary, and merging them is a mistake nobody can unpick afterwards. A
 * duplicate the owner merges later is recoverable; a wrong merge is not.
 */
async function findExistingClient(
  tx: Prisma.TransactionClient,
  salonId: string,
  row: RawImportRow,
): Promise<string | null> {
  if (row.phone) {
    const byPhone = await tx.clientProfile.findFirst({
      where: { salonId, phone: row.phone, status: { not: 'ERASED' } },
      select: { id: true },
    })
    if (byPhone) return byPhone.id
  }
  if (row.email) {
    const byEmail = await tx.clientProfile.findFirst({
      where: { salonId, email: row.email, status: { not: 'ERASED' } },
      select: { id: true },
    })
    if (byEmail) return byEmail.id
  }
  return null
}

/**
 * Every handle a row gives for the person on it.
 *
 * All of them, not the best one. Exports are ragged: the same client's phone
 * appears on their colour appointment and not on their blow-dry, and keying on
 * a single preferred handle turns one person into two — the most visible way an
 * import can be wrong, and the one an owner notices on the first screen.
 *
 * Ordered by how much each is worth. A phone number is the only one a salon's
 * own front desk has never typed two different ways; a name alone is a guess,
 * and it is last because two Sarah Joneses are ordinary.
 */
function identityKeys(row: RawImportRow): string[] {
  const keys: string[] = []
  if (row.phone) keys.push(`p:${row.phone}`)
  if (row.email) keys.push(`e:${row.email}`)
  if (row.firstName) {
    keys.push(`n:${row.firstName.toLowerCase()}|${(row.lastName ?? '').toLowerCase()}`)
  }
  return keys
}

function fullName(client: { firstName: string; lastName: string | null }): string {
  return client.lastName ? `${client.firstName} ${client.lastName}` : client.firstName
}
