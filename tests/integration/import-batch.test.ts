import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { parseImport } from '@/domain/migration/parse'
import {
  batchesDueForFileDeletion,
  commitBatch,
  createBatch,
  markSourceDeleted,
  undoBatch,
} from '@/server/services/migration/batch'
import { commitStaffImport, previewStaffImport } from '@/server/services/migration/staff'

/**
 * An import, and the way back out of it.
 *
 * The owner will get the first file wrong — the wrong export, the wrong date
 * order, the stylist's name in the notes column — and everything here exists to
 * make that survivable. The tests that matter are not the ones where the import
 * works; they are the ones where somebody has already depended on what it
 * created before the owner changed their mind.
 */

const S = 'ib_salon'
const TZ = 'Europe/London'
const BY = 'ib_owner'

const FILE = [
  'Client,Mobile,Email,Date,Time,Service,Team member,Price,Status',
  'Ada Rivera,07700 900123,ada@example.com,03/04/2024,14:30,Balayage,Wren,£285,Completed',
  'Ada Rivera,07700 900123,ada@example.com,13/04/2024,09:00,Toner,Wren,£45,Completed',
  'Bea Chen,07700 900456,bea@example.com,14/04/2024,11:00,Balayage,Wren,£285,Cancelled',
].join('\n')

const OPTIONS = {
  serviceMap: { Balayage: 'ib_svc', Toner: null },
  stylistMap: { Wren: 'ib_sty' },
}

function rowsOf(text = FILE) {
  return parseImport(text, { platform: 'FRESHA', defaultCallingCode: '44' }).rows
}

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'ib-' } } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'ib-salon',
      name: 'Import Test Salon',
      defaultTimezone: TZ,
      settings: { create: {} },
      locations: { create: { id: 'ib_loc', name: 'Main', timezone: TZ } },
      serviceCategories: { create: { id: 'ib_cat', name: 'Hair', slug: 'hair' } },
    },
  })

  await unsafeDb.user.create({ data: { id: 'ib_user', email: 'ib-sty@example.com' } })
  await unsafeDb.membership.create({
    data: { id: 'ib_mem', salonId: S, userId: 'ib_user', role: 'STYLIST' },
  })
  await unsafeDb.stylistProfile.create({
    data: { id: 'ib_sty', salonId: S, membershipId: 'ib_mem', displayName: 'Wren' },
  })
  await unsafeDb.service.create({
    data: {
      id: 'ib_svc',
      salonId: S,
      categoryId: 'ib_cat',
      name: 'Balayage',
      slug: 'balayage',
      basePriceCents: 28_500,
    },
  })
}

async function newBatch(sourceAssetKey: string | null = 'imports/ib/clients.csv') {
  return createBatch(S, {
    locationId: 'ib_loc',
    filename: 'clients.csv',
    sourcePlatform: 'FRESHA',
    sourceAssetKey,
    createdByUserId: BY,
  })
}

beforeEach(seed)
afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'ib-' } } })
})

describe('committing a file', () => {
  it('makes one client per person, not one per row', async () => {
    // Ada is on two rows. A file of four thousand appointments is usually six
    // hundred people, and importing it as four thousand clients is the failure
    // every owner notices immediately and never forgives.
    const batch = await newBatch()
    const counts = await commitBatch(S, batch.id, rowsOf(), OPTIONS)

    expect(counts.clientsCreated).toBe(2)
    expect(counts.appointmentsCreated).toBe(3)

    const clients = await unsafeDb.clientProfile.findMany({ where: { salonId: S } })
    expect(clients).toHaveLength(2)
    expect(clients.map((c) => c.source)).toEqual(['IMPORT', 'IMPORT'])
  })

  it('stamps everything it writes with the batch that wrote it', async () => {
    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(), OPTIONS)

    const orphans = await unsafeDb.appointment.count({
      where: { salonId: S, importBatchId: null },
    })
    expect(orphans).toBe(0)
  })

  it('writes history rather than bookings', async () => {
    /*
     * No segments. A segment is a claim on a stylist's time and lives under the
     * exclusion constraint, so one overlap in a sloppy export would fail the
     * entire migration — and nobody is scrolling a diary back to April 2024.
     */
    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(), OPTIONS)

    expect(await unsafeDb.appointmentSegment.count({ where: { salonId: S } })).toBe(0)

    const cancelled = await unsafeDb.appointment.findFirst({
      where: { salonId: S, status: 'CANCELLED' },
    })
    expect(cancelled?.cancelledAt).not.toBeNull()
    expect(cancelled?.checkedOutAt).toBeNull()
    // A cancellation took no money, whatever the price column said.
    expect(cancelled?.actualTotalCents).toBeNull()
  })

  it('reads the date and the local time through the location’s own clock', async () => {
    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(), OPTIONS)

    const first = await unsafeDb.appointment.findFirst({
      where: { salonId: S },
      orderBy: { startsAt: 'asc' },
    })
    // 14:30 on 3 April 2024 in London is 13:30 UTC — British Summer Time.
    expect(first?.startsAt.toISOString()).toBe('2024-04-03T13:30:00.000Z')
  })

  it('imports an appointment whose service nobody mapped, and says so', async () => {
    /*
     * The visit happened. Refusing it because the salon has not decided what
     * "Toner" maps onto would lose real history over a naming question.
     */
    const batch = await newBatch()
    const counts = await commitBatch(S, batch.id, rowsOf(), OPTIONS)

    expect(counts.appointmentsUnmappedService).toBe(1)
    expect(await unsafeDb.appointmentService.count({ where: { salonId: S } })).toBe(2)
  })

  it('refuses to invent a stylist for a row it cannot attribute', async () => {
    /*
     * `primaryStylistId` is not nullable and the tempting fix is whoever is
     * first in the list. This platform reports rebook rate per stylist —
     * inventing the attribution is how somebody gets appraised on another
     * stylist's clients.
     */
    const batch = await newBatch()
    const counts = await commitBatch(S, batch.id, rowsOf(), { ...OPTIONS, stylistMap: {} })

    expect(counts.appointmentsCreated).toBe(0)
    expect(counts.appointmentsSkipped).toBe(3)
    // The people still arrive. Only the attribution is withheld.
    expect(counts.clientsCreated).toBe(2)
  })

  it('finds a client the salon already has instead of making a second one', async () => {
    await unsafeDb.clientProfile.create({
      data: {
        id: 'ib_known',
        salonId: S,
        firstName: 'Ada',
        lastName: 'Rivera',
        phone: '+447700900123',
      },
    })

    const batch = await newBatch()
    const counts = await commitBatch(S, batch.id, rowsOf(), OPTIONS)

    expect(counts.clientsMatched).toBe(1)
    expect(counts.clientsCreated).toBe(1)
    const ada = await unsafeDb.appointment.findFirst({
      where: { salonId: S, clientProfileId: 'ib_known' },
    })
    expect(ada).not.toBeNull()
  })

  it('does not leave a whole salon looking like first-timers', async () => {
    /*
     * `completedVisits === 0` is how this platform asks "is this a new client",
     * in nine places. A migrated salon whose entire book reads as never having
     * visited would fire its new-client welcome at every client it has, on the
     * morning they switched.
     */
    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(), OPTIONS)

    const ada = await unsafeDb.clientProfile.findFirstOrThrow({
      where: { salonId: S, phone: '+447700900123' },
    })
    expect(ada.completedVisits).toBe(2)
    expect(ada.lifetimeSpendCents).toBe(33_000)
    expect(ada.firstVisitAt?.toISOString()).toBe('2024-04-03T13:30:00.000Z')
    expect(ada.lastVisitAt?.toISOString()).toBe('2024-04-13T08:00:00.000Z')

    // The cancelled visit is not a visit.
    const bea = await unsafeDb.clientProfile.findFirstOrThrow({
      where: { salonId: S, phone: '+447700900456' },
    })
    expect(bea.completedVisits).toBe(0)
    expect(bea.lastVisitAt).toBeNull()
  })

  it('dates a formula from when the colour went on, not when it was imported', async () => {
    /*
     * `createdAt` defaults to now(), and that is the clock anything asking "how
     * grown out is this" would read. Left alone, a whole salon comes back as
     * having been coloured on migration day.
     */
    const withFormula = [
      'Client,Mobile,Date,Time,Service,Team member,Formula',
      'Ada Rivera,07700 900123,03/04/2024,14:30,Balayage,Wren,7.1 + 6% 40min',
    ].join('\n')

    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(withFormula), OPTIONS)

    const formula = await unsafeDb.formula.findFirstOrThrow({ where: { salonId: S } })
    expect(formula.createdAt.toISOString()).toBe('2024-04-03T13:30:00.000Z')
    expect(formula.applicationNotes).toBe('7.1 + 6% 40min')
  })

  it('recounts a client the salon already had, and puts it back on undo', async () => {
    await unsafeDb.clientProfile.create({
      data: {
        id: 'ib_known',
        salonId: S,
        firstName: 'Ada',
        lastName: 'Rivera',
        phone: '+447700900123',
      },
    })

    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(), OPTIONS)
    expect(
      (await unsafeDb.clientProfile.findUniqueOrThrow({ where: { id: 'ib_known' } })).completedVisits,
    ).toBe(2)

    await undoBatch(S, batch.id, BY)

    // They survive — the salon had them first — and their counters no longer
    // credit history that has been taken away.
    const after = await unsafeDb.clientProfile.findUniqueOrThrow({ where: { id: 'ib_known' } })
    expect(after.completedVisits).toBe(0)
    expect(after.lifetimeSpendCents).toBe(0)
    expect(after.lastVisitAt).toBeNull()
  })

  it('will not run the same batch twice', async () => {
    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(), OPTIONS)
    await expect(commitBatch(S, batch.id, rowsOf(), OPTIONS)).rejects.toThrow(/already been run/)
  })
})

describe('undoing it', () => {
  it('is one operation', async () => {
    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(), OPTIONS)

    const result = await undoBatch(S, batch.id, BY)

    expect(result.clientsDeleted).toBe(2)
    expect(result.appointmentsDeleted).toBe(3)
    expect(result.clientsKept).toEqual([])
    expect(await unsafeDb.clientProfile.count({ where: { salonId: S } })).toBe(0)
    expect(await unsafeDb.appointment.count({ where: { salonId: S } })).toBe(0)
  })

  it('leaves the salon exactly as it was, including what the import matched', async () => {
    // A client the salon already had is not the import's to delete.
    await unsafeDb.clientProfile.create({
      data: {
        id: 'ib_known',
        salonId: S,
        firstName: 'Ada',
        lastName: 'Rivera',
        phone: '+447700900123',
      },
    })

    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(), OPTIONS)
    await undoBatch(S, batch.id, BY)

    const left = await unsafeDb.clientProfile.findMany({ where: { salonId: S } })
    expect(left.map((c) => c.id)).toEqual(['ib_known'])
  })

  it('keeps a client who has signed in and says why', async () => {
    /*
     * They claimed the record during a parallel run. Deleting them now takes a
     * real person's login with it, which is a worse support ticket than the one
     * undo exists to avoid.
     */
    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(), OPTIONS)

    const ada = await unsafeDb.clientProfile.findFirstOrThrow({
      where: { salonId: S, phone: '+447700900123' },
    })
    await unsafeDb.user.create({ data: { id: 'ib_ada_user', email: 'ib-ada@example.com' } })
    await unsafeDb.clientProfile.update({
      where: { id: ada.id },
      data: { userId: 'ib_ada_user' },
    })

    const result = await undoBatch(S, batch.id, BY)

    expect(result.clientsDeleted).toBe(1)
    expect(result.clientsKept).toEqual([
      { id: ada.id, name: 'Ada Rivera', reason: 'They have signed in and claimed this record.' },
    ])
    expect(await unsafeDb.clientProfile.findUnique({ where: { id: ada.id } })).not.toBeNull()
  })

  it('keeps a client who has booked since, and does not take the booking with them', async () => {
    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(), OPTIONS)

    const bea = await unsafeDb.clientProfile.findFirstOrThrow({
      where: { salonId: S, phone: '+447700900456' },
    })
    await unsafeDb.appointment.create({
      data: {
        id: 'ib_real',
        salonId: S,
        locationId: 'ib_loc',
        clientProfileId: bea.id,
        primaryStylistId: 'ib_sty',
        startsAt: new Date('2026-09-14T13:00:00Z'),
        endsAt: new Date('2026-09-14T14:00:00Z'),
        estimatedDurationMin: 60,
      },
    })

    const result = await undoBatch(S, batch.id, BY)

    expect(result.clientsKept.map((c) => c.name)).toEqual(['Bea Chen'])
    expect(result.clientsKept[0]?.reason).toMatch(/did not come from this import/)
    // The real Tuesday survives; the imported history does not.
    expect(await unsafeDb.appointment.findUnique({ where: { id: 'ib_real' } })).not.toBeNull()
    expect(await unsafeDb.appointment.count({ where: { salonId: S, importBatchId: batch.id } })).toBe(
      0,
    )
  })

  it('clears the visit counters of a client it kept', async () => {
    // "42 visits" over an empty timeline reads as the platform having lost the
    // data, which is precisely the fear undo is meant to settle.
    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(), OPTIONS)

    const ada = await unsafeDb.clientProfile.findFirstOrThrow({
      where: { salonId: S, phone: '+447700900123' },
    })
    await unsafeDb.user.create({ data: { id: 'ib_ada_user', email: 'ib-ada@example.com' } })
    await unsafeDb.clientProfile.update({
      where: { id: ada.id },
      data: { userId: 'ib_ada_user', completedVisits: 42, lifetimeSpendCents: 99_000 },
    })

    await undoBatch(S, batch.id, BY)

    const after = await unsafeDb.clientProfile.findUniqueOrThrow({ where: { id: ada.id } })
    expect(after.completedVisits).toBe(0)
    expect(after.lifetimeSpendCents).toBe(0)
  })

  it('keeps the batch as the record that it happened', async () => {
    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(), OPTIONS)
    await undoBatch(S, batch.id, BY)

    const after = await unsafeDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } })
    expect(after.status).toBe('UNDONE')
    expect(after.undoneByUserId).toBe(BY)
    expect(after.countsJson).toMatchObject({ clientsCreated: 2 })
  })

  it('refuses a second undo', async () => {
    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(), OPTIONS)
    await undoBatch(S, batch.id, BY)
    await expect(undoBatch(S, batch.id, BY)).rejects.toThrow(/already been undone/)
  })
})

describe('the file the owner uploaded', () => {
  it('is only up for deletion once the import has finished', async () => {
    /*
     * Retention runs from completion rather than upload, so a stalled import is
     * never deleted out from under an owner mid-review.
     */
    const pending = await newBatch()
    const future = new Date(Date.now() + 86_400_000)
    expect(await batchesDueForFileDeletion(S, future)).toEqual([])

    await commitBatch(S, pending.id, rowsOf(), OPTIONS)
    expect((await batchesDueForFileDeletion(S, future)).map((b) => b.id)).toEqual([pending.id])
  })

  it('leaves the audit record behind when the file goes', async () => {
    // A raw export holds a salon's whole client list in the clear. The record
    // that an import happened does not.
    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(), OPTIONS)
    await markSourceDeleted(S, batch.id)

    const after = await unsafeDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } })
    expect(after.sourceAssetKey).toBeNull()
    expect(after.sourceDeletedAt).not.toBeNull()
    expect(after.filename).toBe('clients.csv')
    expect(await batchesDueForFileDeletion(S, new Date(Date.now() + 86_400_000))).toEqual([])
  })
})

describe('a parallel run', () => {
  /*
   * Between import and go-live the old platform is still the system of record
   * and staff poke at the new one. A future appointment written as a plain
   * history row leaves this platform believing that chair is free — which turns
   * the parallel run into the cause of the double-booking it existed to prevent.
   */
  const FUTURE = [
    'Client,Mobile,Date,Time,Service,Team member,Duration',
    'Ada Rivera,07700 900123,20/09/2027,14:00,Balayage,Wren,60',
  ].join('\n')

  it('books an upcoming appointment for real, holding the chair', async () => {
    const batch = await newBatch()
    const counts = await commitBatch(S, batch.id, rowsOf(FUTURE), OPTIONS)

    expect(counts.appointmentsBooked).toBe(1)
    const segments = await unsafeDb.appointmentSegment.findMany({ where: { salonId: S } })
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ stylistProfileId: 'ib_sty', blocksStylist: true })
  })

  it('still leaves history without segments', async () => {
    // Four thousand historical segments under the exclusion constraint would
    // let one overlap in a sloppy export fail the whole migration.
    const batch = await newBatch()
    const counts = await commitBatch(S, batch.id, rowsOf(), OPTIONS)

    expect(counts.appointmentsBooked).toBe(0)
    expect(await unsafeDb.appointmentSegment.count({ where: { salonId: S } })).toBe(0)
  })

  it('refuses one whose chair is already taken, without losing the rest', async () => {
    /*
     * Checked before the insert rather than caught after it: the exclusion
     * constraint aborts the whole transaction, and a clash on one Tuesday is
     * not a reason to refuse a salon's entire history.
     */
    await unsafeDb.appointment.create({
      data: {
        id: 'ib_taken',
        salonId: S,
        locationId: 'ib_loc',
        clientProfileId: (
          await unsafeDb.clientProfile.create({
            data: { id: 'ib_other', salonId: S, firstName: 'Bea', lastName: 'Chen' },
          })
        ).id,
        primaryStylistId: 'ib_sty',
        startsAt: new Date('2027-09-20T13:00:00Z'),
        endsAt: new Date('2027-09-20T14:00:00Z'),
        estimatedDurationMin: 60,
        segments: {
          create: {
            salonId: S,
            locationId: 'ib_loc',
            stylistProfileId: 'ib_sty',
            kind: 'ACTIVE',
            startsAt: new Date('2027-09-20T13:00:00Z'),
            endsAt: new Date('2027-09-20T14:00:00Z'),
          },
        },
      },
    })

    const batch = await newBatch()
    const counts = await commitBatch(S, batch.id, rowsOf(FUTURE), OPTIONS)

    expect(counts.appointmentsClashed).toBe(1)
    expect(counts.appointmentsBooked).toBe(0)
    // The client still comes across — only the clashing booking is refused.
    expect(counts.clientsCreated).toBe(1)
  })

  it('takes the booking back out again on undo', async () => {
    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(FUTURE), OPTIONS)
    await undoBatch(S, batch.id, BY)

    expect(await unsafeDb.appointmentSegment.count({ where: { salonId: S } })).toBe(0)
  })
})

describe('consent an import can honestly claim', () => {
  it('grants transactional and refuses marketing', async () => {
    /*
     * Transactional is defensible — these are the salon's own clients and the
     * messages are about appointments they made. Marketing is not: a CSV column
     * saying "yes" is somebody else's software's word for a conversation this
     * salon cannot produce.
     *
     * Written rather than left absent, which is the part that matters: the send
     * path treats a missing row as permission for transactional messages, so an
     * imported client with no rows is being messaged on an omission rather than
     * a decision, with nothing afterwards to say which.
     */
    const batch = await newBatch()
    await commitBatch(S, batch.id, rowsOf(), OPTIONS)

    const ada = await unsafeDb.clientProfile.findFirstOrThrow({
      where: { salonId: S, phone: '+447700900123' },
    })
    const consents = await unsafeDb.contactConsent.findMany({
      where: { clientProfileId: ada.id },
      orderBy: [{ channel: 'asc' }, { purpose: 'asc' }],
    })

    expect(consents).toHaveLength(4)
    expect(consents.filter((c) => c.purpose === 'MARKETING').every((c) => c.status === 'REVOKED')).toBe(
      true,
    )
    expect(
      consents.filter((c) => c.purpose === 'TRANSACTIONAL').every((c) => c.status === 'GRANTED'),
    ).toBe(true)
    expect(consents.every((c) => c.capturedVia === 'IMPORT')).toBe(true)
  })
})

describe('bringing the team across', () => {
  const STAFF = [
    'Name,Email,Title,Skills',
    'Wren Ashby,wren@ib.test,Senior colourist,"Balayage; Colour correction"',
    'Jo Marlow,jo@ib.test,Stylist,"Highlights, Nail art"',
    'Nameless,,,Balayage',
  ].join('\n')

  it('reads names and skills, and says which skills it did not know', async () => {
    /*
     * A stylist wrongly credited with COLOR_CORRECTION is one the solver will
     * happily book a corrective on. A name the list does not recognise is
     * reported, never guessed at.
     */
    const preview = await previewStaffImport(S, STAFF)

    expect(preview.rows[0]).toMatchObject({
      displayName: 'Wren Ashby',
      email: 'wren@ib.test',
      skills: ['BALAYAGE', 'COLOR_CORRECTION'],
      unknownSkills: [],
    })
    expect(preview.rows[1]?.skills).toEqual(['FOILS'])
    expect(preview.rows[1]?.unknownSkills).toEqual(['Nail art'])
  })

  it('creates the ones it can and skips the ones with nothing to hang a login on', async () => {
    const preview = await previewStaffImport(S, STAFF)
    const result = await commitStaffImport(S, preview.rows, 'ib_loc')

    expect(result).toMatchObject({ created: 2, skipped: 1 })
    const wren = await unsafeDb.stylistProfile.findFirstOrThrow({
      where: { salonId: S, displayName: 'Wren Ashby' },
      include: { skills: true },
    })
    // Competent, not expert — the file said they do balayage, not that they are
    // the best in the building.
    expect(wren.skills.map((s) => s.level)).toEqual([3, 3])
  })

  it('never imports a rota', async () => {
    /*
     * The one thing in a salon that changes weekly and is remembered by
     * everybody in the building. A confidently wrong rota is worse than an
     * empty one, because an empty one gets filled in.
     */
    const preview = await previewStaffImport(
      S,
      'Name,Email,Working Hours\nWren Ashby,wren@ib.test,Mon-Fri 9-5',
    )
    await commitStaffImport(S, preview.rows, 'ib_loc')

    expect(await unsafeDb.workingHours.count({ where: { salonId: S } })).toBe(0)
  })

  it('updates somebody already on the team rather than duplicating them', async () => {
    await previewStaffImport(S, STAFF).then((p) => commitStaffImport(S, p.rows, 'ib_loc'))
    const again = await previewStaffImport(S, STAFF)

    expect(again.existing['Wren Ashby']).toBeDefined()
    const result = await commitStaffImport(S, again.rows, 'ib_loc')
    expect(result).toMatchObject({ created: 0, updated: 2, skipped: 1 })
    expect(await unsafeDb.stylistProfile.count({ where: { salonId: S } })).toBe(3)
  })
})
