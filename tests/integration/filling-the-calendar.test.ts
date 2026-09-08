import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { invalidateAvailabilityCache } from '@/server/services/scheduling/loader'
import { localTimeToEpochMinutes, toEpochMinutes } from '@/domain/scheduling/zoned'
import {
  chainForServices,
  findSlotsForServices,
  resolveSlotForServices,
} from '@/server/services/scheduling/slots'
import { bookFromDesk, deskBookingContext } from '@/server/services/scheduling/staff-booking'
import { loadGap } from '@/server/services/scheduling/gap-fill'
import {
  acceptOffer,
  declineOffer,
  joinWaitlist,
  matchWaitlist,
  sweepExpiredOffers,
} from '@/server/services/scheduling/waitlist'
import { bookFromHold, createHold } from '@/server/services/scheduling/booking'

/**
 * Filling the calendar.
 *
 * Everything here was already in the schema and the solver and had no door:
 * a search that did not open with `loadPlan`, a gate deciding when a
 * consultation is actually needed, a way to book into the gold processing
 * blocks the diary has been drawing for months, and a waitlist whose five
 * preference fields nothing ever read.
 */

const S = 'fc_salon'
const TZ = 'America/New_York'
const DATE = '2026-09-14' // a Monday
const at = (h: number, m = 0) => localTimeToEpochMinutes(DATE, h * 60 + m, TZ)

const SETTINGS = {
  slotGranularityMin: 15,
  minBookingLeadMin: 0,
  maxAdvanceDays: 365,
  allowFinishAfterCloseMin: 0,
  interleaveEnabled: true,
  maxConcurrentClients: 2,
  minInterleaveMin: 20,
}

/** Before the day, so `minBookingLeadMin` never rules the whole day out. */
const NOW = new Date(`${DATE}T08:00:00-04:00`)

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'fc-' } } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'fc-salon',
      name: 'Calendar Test Salon',
      defaultTimezone: TZ,
      settings: { create: { ...SETTINGS } },
      locations: { create: { id: 'fc_loc', name: 'Main', timezone: TZ } },
      serviceCategories: { create: { id: 'fc_cat', name: 'Hair', slug: 'hair' } },
    },
  })

  await unsafeDb.user.create({ data: { id: 'fc_user', email: 'fc-sty@example.com' } })
  await unsafeDb.membership.create({
    data: { id: 'fc_mem', salonId: S, userId: 'fc_user', role: 'STYLIST' },
  })
  await unsafeDb.stylistProfile.create({
    data: { id: 'fc_sty', salonId: S, membershipId: 'fc_mem', displayName: 'Wren' },
  })

  await unsafeDb.workingHours.createMany({
    data: [
      { salonId: S, locationId: 'fc_loc', dayOfWeek: 1, startMinute: 540, endMinute: 1080 },
      { salonId: S, stylistProfileId: 'fc_sty', dayOfWeek: 1, startMinute: 540, endMinute: 1080 },
    ],
  })

  // A dry cut: nothing in the way of booking it.
  await unsafeDb.service.create({
    data: {
      id: 'fc_cut',
      salonId: S,
      categoryId: 'fc_cat',
      name: 'Dry cut',
      slug: 'dry-cut',
      basePriceCents: 4_500,
      phases: {
        create: {
          salonId: S,
          sequence: 0,
          kind: 'ACTIVE',
          label: 'Cut',
          durationMin: 30,
          requiresStylist: true,
        },
      },
    },
  })

  // A tint: chemical, and it needs a patch test.
  await unsafeDb.service.create({
    data: {
      id: 'fc_tint',
      salonId: S,
      categoryId: 'fc_cat',
      name: 'Root tint',
      slug: 'root-tint',
      basePriceCents: 9_000,
      isChemical: true,
      containsDye: true,
      requiresPatchTest: true,
      phases: {
        create: [
          {
            salonId: S,
            sequence: 0,
            kind: 'ACTIVE',
            label: 'Apply',
            durationMin: 30,
            requiresStylist: true,
          },
          {
            // The gold block. The stylist is free through this.
            salonId: S,
            sequence: 1,
            kind: 'PROCESSING',
            label: 'Develop',
            durationMin: 45,
            requiresStylist: false,
          },
          {
            salonId: S,
            sequence: 2,
            kind: 'RINSE',
            label: 'Rinse and finish',
            durationMin: 30,
            requiresStylist: true,
          },
        ],
      },
    },
  })

  // Lightening, which gates itself with the checkbox left unticked.
  await unsafeDb.service.create({
    data: {
      id: 'fc_bleach',
      salonId: S,
      categoryId: 'fc_cat',
      name: 'Balayage',
      slug: 'balayage',
      basePriceCents: 22_000,
      isChemical: true,
      isLightening: true,
      phases: {
        create: {
          salonId: S,
          sequence: 0,
          kind: 'ACTIVE',
          label: 'Paint',
          durationMin: 90,
          requiresStylist: true,
        },
      },
    },
  })
}

beforeAll(seed, 90_000)

beforeEach(async () => {
  await unsafeDb.waitlistEntry.deleteMany({ where: { salonId: S } })
  await unsafeDb.appointmentSegment.deleteMany({ where: { salonId: S } })
  await unsafeDb.appointment.deleteMany({ where: { salonId: S } })
  await unsafeDb.bookingHold.deleteMany({ where: { salonId: S } })
  await unsafeDb.patchTest.deleteMany({ where: { salonId: S } })
  await unsafeDb.clientProfile.deleteMany({ where: { salonId: S } })
  await unsafeDb.outbox.deleteMany({ where: { salonId: S } })
  await unsafeDb.externalBusy.deleteMany({ where: { salonId: S } })
  invalidateAvailabilityCache(S)
})

afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'fc-' } } })
  await unsafeDb.$disconnect()
})

async function makeClient(name = 'Ada') {
  return unsafeDb.clientProfile.create({
    data: { salonId: S, firstName: name, lastName: 'Rivera' },
    select: { id: true },
  })
}

async function givePatchTest(clientProfileId: string) {
  await unsafeDb.patchTest.create({
    data: {
      salonId: S,
      clientProfileId,
      appliedAt: new Date(NOW.getTime() - 7 * 86_400_000),
      readAt: new Date(NOW.getTime() - 5 * 86_400_000),
      result: 'NEGATIVE',
      validUntil: new Date(NOW.getTime() + 90 * 86_400_000),
    },
  })
}

// ---------------------------------------------------------------------------

describe("a stylist's own calendar", () => {
  it('blocks a slot the salon does not otherwise know is taken', async () => {
    /*
     * `externalBusy` was written to be called from the availability solver, and
     * calling it there would have put somebody else's server in the booking hot
     * path: every search waiting on Google, and a slow token refresh reading to
     * a client as "this salon has nothing free". Mirrored on a timer instead,
     * into rows the loader treats like any other blocked interval — which is
     * only worth anything if the solver actually respects them.
     */
    const before = await findSlotsForServices({
      salonId: S,
      serviceIds: ['fc_cut'],
      fromDate: DATE,
      toDate: DATE,
      now: NOW,
    })
    const taken = before.slots[0]!

    await unsafeDb.externalBusy.create({
      data: {
        salonId: S,
        stylistProfileId: 'fc_sty',
        startsAt: new Date(taken.startsAt),
        endsAt: new Date(new Date(taken.startsAt).getTime() + 4 * 3_600_000),
        source: 'google:fc_sty',
      },
    })
    // The first search populated the loader's cache; the mirror job runs on a
    // timer and does the same thing in production.
    invalidateAvailabilityCache(S)

    const after = await findSlotsForServices({
      salonId: S,
      serviceIds: ['fc_cut'],
      fromDate: DATE,
      toDate: DATE,
      now: NOW,
    })

    expect(after.slots.some((slot) => slot.startsAt === taken.startsAt)).toBe(false)
    // And the rest of the day is untouched — an outside commitment blocks the
    // hours it covers, not the stylist.
    expect(after.slots.length).toBeGreaterThan(0)
  })
})

describe('a search with no plan behind it', () => {
  it('finds times for an arbitrary basket', async () => {
    const result = await findSlotsForServices({
      salonId: S,
      serviceIds: ['fc_cut'],
      fromDate: DATE,
      toDate: DATE,
      now: NOW,
    })

    expect(result.slots.length).toBeGreaterThan(0)
    expect(result.slots[0]!.stylistId).toBe('fc_sty')
  })

  it('builds the chain from the catalog, so the duration is real', async () => {
    const chain = await chainForServices(S, ['fc_tint'])
    // 30 apply + 45 develop + 30 rinse, plus the default 10-minute clean-down.
    expect(chain.reduce((sum, link) => sum + link.durationMin, 0)).toBe(115)
  })

  it('refuses a service that is not on the menu', async () => {
    await expect(chainForServices(S, ['fc_cut', 'nope'])).rejects.toThrow(/no longer offered/i)
  })

  it('re-solves a chosen slot rather than trusting the token', async () => {
    const result = await findSlotsForServices({
      salonId: S,
      serviceIds: ['fc_cut'],
      fromDate: DATE,
      toDate: DATE,
      now: NOW,
    })
    const token = result.slots[0]!.token

    expect(
      await resolveSlotForServices({ salonId: S, serviceIds: ['fc_cut'], token, now: NOW }),
    ).not.toBeNull()

    // A token for a time that does not exist resolves to nothing rather than
    // being reconstructed into a booking.
    expect(
      await resolveSlotForServices({
        salonId: S,
        serviceIds: ['fc_cut'],
        token: `fc_sty|${at(3)}|${at(4)}|${DATE}`,
        now: NOW,
      }),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('the consultation gate, against real rows', () => {
  it('lets a haircut straight through', async () => {
    const client = await makeClient()
    const context = await deskBookingContext({
      salonId: S,
      clientProfileId: client.id,
      serviceIds: ['fc_cut'],
    })
    expect(context.gate.decision).toBe('DIRECT')
  })

  it('refuses a tint with no patch test, and says what to do', async () => {
    const client = await makeClient()
    const context = await deskBookingContext({
      salonId: S,
      clientProfileId: client.id,
      serviceIds: ['fc_tint'],
    })
    expect(context.gate.decision).toBe('REFUSED')
    expect(context.gate.reason).toMatch(/patch test/i)
  })

  it('drops a tint to needing sign-off once the patch test is on file', async () => {
    const client = await makeClient()
    await givePatchTest(client.id)
    const context = await deskBookingContext({
      salonId: S,
      clientProfileId: client.id,
      serviceIds: ['fc_tint'],
    })
    expect(context.gate.decision).toBe('OVERRIDABLE')
  })

  it('books a haircut from the desk with nobody signing anything', async () => {
    const client = await makeClient()
    const result = await findSlotsForServices({
      salonId: S,
      serviceIds: ['fc_cut'],
      fromDate: DATE,
      toDate: DATE,
      now: NOW,
    })

    const booking = await bookFromDesk({
      salonId: S,
      clientProfileId: client.id,
      serviceIds: ['fc_cut'],
      token: result.slots[0]!.token,
      timeZone: TZ,
      now: NOW,
    })

    const appointment = await unsafeDb.appointment.findUniqueOrThrow({
      where: { id: booking.appointmentId },
    })
    expect(appointment.source).toBe('FRONT_DESK')
    expect(appointment.internalNote).toBeNull()
  })

  it('refuses lightening to somebody who cannot sign it off', async () => {
    const client = await makeClient()
    const result = await findSlotsForServices({
      salonId: S,
      serviceIds: ['fc_bleach'],
      fromDate: DATE,
      toDate: DATE,
      now: NOW,
    })

    await expect(
      bookFromDesk({
        salonId: S,
        clientProfileId: client.id,
        serviceIds: ['fc_bleach'],
        token: result.slots[0]!.token,
        timeZone: TZ,
        mayOverride: false,
        now: NOW,
      }),
    ).rejects.toThrow(/lifts colour|manager/i)
  })

  it('demands a reason even from somebody who can', async () => {
    const client = await makeClient()
    const result = await findSlotsForServices({
      salonId: S,
      serviceIds: ['fc_bleach'],
      fromDate: DATE,
      toDate: DATE,
      now: NOW,
    })

    await expect(
      bookFromDesk({
        salonId: S,
        clientProfileId: client.id,
        serviceIds: ['fc_bleach'],
        token: result.slots[0]!.token,
        timeZone: TZ,
        mayOverride: true,
        overrideReason: '  ',
        now: NOW,
      }),
    ).rejects.toThrow(/say why/i)
  })

  it('writes the reason where the stylist will actually see it', async () => {
    const client = await makeClient()
    const result = await findSlotsForServices({
      salonId: S,
      serviceIds: ['fc_bleach'],
      fromDate: DATE,
      toDate: DATE,
      now: NOW,
    })

    const booking = await bookFromDesk({
      salonId: S,
      clientProfileId: client.id,
      serviceIds: ['fc_bleach'],
      token: result.slots[0]!.token,
      timeZone: TZ,
      mayOverride: true,
      overrideReason: 'Regular client, same as her last four visits.',
      now: NOW,
    })

    const appointment = await unsafeDb.appointment.findUniqueOrThrow({
      where: { id: booking.appointmentId },
    })
    // On the card the person holding the brush is looking at, not only in an
    // audit log nobody reads.
    expect(appointment.internalNote).toMatch(/without a consultation/i)
    expect(appointment.internalNote).toMatch(/last four visits/i)
  })

  it('cannot be talked past by a stale screen', async () => {
    /*
     * The gate is checked on the WRITE. A screen that rendered before the
     * patch test expired, or a request replayed from a tab left open, must not
     * be able to post its way through.
     */
    const client = await makeClient()
    await givePatchTest(client.id)

    const result = await findSlotsForServices({
      salonId: S,
      serviceIds: ['fc_tint'],
      fromDate: DATE,
      toDate: DATE,
      now: NOW,
    })
    const token = result.slots[0]!.token

    await unsafeDb.patchTest.deleteMany({ where: { salonId: S, clientProfileId: client.id } })

    await expect(
      bookFromDesk({
        salonId: S,
        clientProfileId: client.id,
        serviceIds: ['fc_tint'],
        token,
        timeZone: TZ,
        mayOverride: true,
        overrideReason: 'She says it is fine.',
        now: NOW,
      }),
    ).rejects.toThrow(/patch test/i)
  })
})

// ---------------------------------------------------------------------------

describe('the gap in the middle of somebody else’s colour', () => {
  async function bookATint() {
    const client = await makeClient('Beatrix')
    await givePatchTest(client.id)

    const result = await findSlotsForServices({
      salonId: S,
      serviceIds: ['fc_tint'],
      fromDate: DATE,
      toDate: DATE,
      now: NOW,
    })
    const booking = await bookFromDesk({
      salonId: S,
      clientProfileId: client.id,
      serviceIds: ['fc_tint'],
      token: result.slots[0]!.token,
      timeZone: TZ,
      mayOverride: true,
      overrideReason: 'Long-standing client.',
      now: NOW,
    })
    return booking
  }

  it('is a real, loadable gap', async () => {
    await bookATint()
    const processing = await unsafeDb.appointmentSegment.findFirstOrThrow({
      where: { salonId: S, blocksStylist: false, state: 'ACTIVE' },
    })

    const gap = await loadGap(S, processing.id)
    expect(gap.stylistId).toBe('fc_sty')
    expect(gap.localDate).toBe(DATE)
    // 45 minutes of developing.
    expect(gap.endMin - gap.startMin).toBe(45)
    expect(gap.occupiedBy).toContain('Beatrix')
  })

  it('refuses to sell time the stylist is working through', async () => {
    await bookATint()
    const working = await unsafeDb.appointmentSegment.findFirstOrThrow({
      where: { salonId: S, blocksStylist: true, state: 'ACTIVE' },
    })

    await expect(loadGap(S, working.id)).rejects.toThrow(/working through/i)
  })

  it('narrows the search to inside the gap', async () => {
    await bookATint()
    const processing = await unsafeDb.appointmentSegment.findFirstOrThrow({
      where: { salonId: S, blocksStylist: false, state: 'ACTIVE' },
    })
    const gap = await loadGap(S, processing.id)

    const result = await findSlotsForServices({
      salonId: S,
      serviceIds: ['fc_cut'],
      fromDate: gap.localDate,
      toDate: gap.localDate,
      stylistId: gap.stylistId,
      window: gap.window,
      now: NOW,
    })

    expect(result.slots.length).toBeGreaterThan(0)
    // Every offer starts inside the gap — that is what the window is for.
    for (const slot of result.slots) {
      const start = toEpochMinutes(new Date(slot.startsAt))
      expect(start).toBeGreaterThanOrEqual(gap.startMin)
      expect(start).toBeLessThanOrEqual(gap.endMin)
    }
  })

  it('will not offer something that overruns the gap', async () => {
    /*
     * The stylist becomes busy again the moment their own client's rinse
     * begins, so a service too long for the gap simply has nowhere to go. The
     * solver decides this, not the window — which is why the window only
     * constrains the START.
     */
    await bookATint()
    const processing = await unsafeDb.appointmentSegment.findFirstOrThrow({
      where: { salonId: S, blocksStylist: false, state: 'ACTIVE' },
    })
    const gap = await loadGap(S, processing.id)

    const result = await findSlotsForServices({
      salonId: S,
      // 90 minutes into a 45-minute gap.
      serviceIds: ['fc_bleach'],
      fromDate: gap.localDate,
      toDate: gap.localDate,
      stylistId: gap.stylistId,
      window: gap.window,
      now: NOW,
    })

    expect(result.slots).toHaveLength(0)
  })

  it('books into it, and both clients keep their time', async () => {
    const first = await bookATint()
    const processing = await unsafeDb.appointmentSegment.findFirstOrThrow({
      where: { salonId: S, blocksStylist: false, state: 'ACTIVE' },
    })
    const gap = await loadGap(S, processing.id)

    const walkIn = await makeClient('Cass')
    const result = await findSlotsForServices({
      salonId: S,
      serviceIds: ['fc_cut'],
      fromDate: gap.localDate,
      toDate: gap.localDate,
      stylistId: gap.stylistId,
      window: gap.window,
      now: NOW,
    })

    const second = await bookFromDesk({
      salonId: S,
      clientProfileId: walkIn.id,
      serviceIds: ['fc_cut'],
      token: result.slots[0]!.token,
      stylistId: gap.stylistId,
      window: gap.window,
      timeZone: TZ,
      now: NOW,
    })

    expect(second.appointmentId).not.toBe(first.appointmentId)
    // Two appointments, one stylist, overlapping in wall-clock time — which is
    // exactly what interleaving is, and the exclusion constraint allowed it
    // because the colour's processing segment does not block the stylist.
    expect(second.startsAt.getTime()).toBeGreaterThanOrEqual(gap.startMin * 60_000)
    expect(second.endsAt.getTime()).toBeLessThanOrEqual(gap.endMin * 60_000)
  })
})

// ---------------------------------------------------------------------------

describe('the waitlist', () => {
  /** Fill the stylist's whole Monday so nothing is free to match against. */
  async function fillTheDay(clientProfileId: string) {
    const { holdId } = await createHold({
      salonId: S,
      locationId: 'fc_loc',
      clientProfileId,
      slot: {
        startMin: at(9),
        endMin: at(18),
        stylistId: 'fc_sty',
        localDate: DATE,
        placements: [
          {
            index: 0,
            kind: 'ACTIVE',
            label: 'All day',
            interval: { start: at(9), end: at(18) },
            resourceId: null,
          },
        ],
        offersInterleave: false,
        score: 1,
      },
      chain: [
        {
          kind: 'ACTIVE',
          label: 'All day',
          durationMin: 540,
          blocksStylist: true,
          blocksResource: false,
          requiresResourceType: null,
          serviceId: null,
        },
      ],
      ttlSeconds: 600,
    })

    const booking = await bookFromHold({
      salonId: S,
      holdId,
      clientProfileId,
      services: [],
      timeZone: TZ,
    })
    invalidateAvailabilityCache(S)
    return booking
  }

  it('takes the duration from the real chain, not from the caller', async () => {
    const client = await makeClient()
    const { id } = await joinWaitlist({
      salonId: S,
      clientProfileId: client.id,
      serviceIds: ['fc_tint'],
      earliestDate: DATE,
      latestDate: DATE,
    })

    const entry = await unsafeDb.waitlistEntry.findUniqueOrThrow({ where: { id } })
    // A client cannot be trusted to know their tint takes 115 minutes with
    // buffers, and a wrong number here is an offer that does not fit.
    expect(entry.requiredDurationMin).toBe(115)
  })

  it('refuses a mask with no days in it', async () => {
    const client = await makeClient()
    await expect(
      joinWaitlist({
        salonId: S,
        clientProfileId: client.id,
        serviceIds: ['fc_cut'],
        earliestDate: DATE,
        latestDate: DATE,
        dayOfWeekMask: 0,
      }),
    ).rejects.toThrow(/at least one day/i)
  })

  it('honours the day mask it has always stored and never read', async () => {
    const blocker = await makeClient('Blocker')
    const waiting = await makeClient('Dana')
    const booking = await fillTheDay(blocker.id)

    // DATE is a Monday. This client only wants Tuesdays and Thursdays.
    await joinWaitlist({
      salonId: S,
      clientProfileId: waiting.id,
      serviceIds: ['fc_cut'],
      earliestDate: DATE,
      latestDate: DATE,
      dayOfWeekMask: (1 << 2) | (1 << 4),
    })

    await unsafeDb.appointmentSegment.deleteMany({
      where: { appointmentId: booking.appointmentId },
    })
    invalidateAvailabilityCache(S)

    const matched = await matchWaitlist({
      salonId: S,
      localDate: DATE,
      freedStartMin: at(9),
      freedEndMin: at(18),
      now: NOW,
    })

    expect(matched.offeredTo).toBeNull()
  })

  it('honours the time-of-day window too', async () => {
    const blocker = await makeClient('Blocker')
    const waiting = await makeClient('Elise')
    const booking = await fillTheDay(blocker.id)

    // Mornings only, and the freed time is the afternoon.
    await joinWaitlist({
      salonId: S,
      clientProfileId: waiting.id,
      serviceIds: ['fc_cut'],
      earliestDate: DATE,
      latestDate: DATE,
      windowStartMinute: 0,
      windowEndMinute: 11 * 60,
    })

    await unsafeDb.appointmentSegment.deleteMany({
      where: { appointmentId: booking.appointmentId },
    })
    invalidateAvailabilityCache(S)

    const matched = await matchWaitlist({
      salonId: S,
      localDate: DATE,
      freedStartMin: at(14),
      freedEndMin: at(17),
      now: NOW,
    })

    expect(matched.offeredTo).toBeNull()
  })

  it('offers, and holds the slot while the client answers', async () => {
    const blocker = await makeClient('Blocker')
    const waiting = await makeClient('Fenna')
    const booking = await fillTheDay(blocker.id)

    const { id } = await joinWaitlist({
      salonId: S,
      clientProfileId: waiting.id,
      serviceIds: ['fc_cut'],
      earliestDate: DATE,
      latestDate: DATE,
    })

    await unsafeDb.appointmentSegment.deleteMany({
      where: { appointmentId: booking.appointmentId },
    })
    invalidateAvailabilityCache(S)

    const matched = await matchWaitlist({
      salonId: S,
      localDate: DATE,
      freedStartMin: at(10),
      freedEndMin: at(13),
      now: NOW,
    })
    expect(matched.offeredTo).toBe(id)

    const entry = await unsafeDb.waitlistEntry.findUniqueOrThrow({ where: { id } })
    expect(entry.status).toBe('OFFERED')

    // A real hold, not a promise. This is the difference between an offer the
    // salon can keep and one it cannot.
    expect(entry.offeredHoldId).toBeTruthy()
    const hold = await unsafeDb.bookingHold.findUniqueOrThrow({
      where: { id: entry.offeredHoldId! },
    })
    expect(hold.status).toBe('ACTIVE')
  })

  it('offers to one person at a time', async () => {
    const blocker = await makeClient('Blocker')
    const first = await makeClient('Gwen')
    const second = await makeClient('Hana')
    const booking = await fillTheDay(blocker.id)

    for (const client of [first, second]) {
      await joinWaitlist({
        salonId: S,
        clientProfileId: client.id,
        serviceIds: ['fc_cut'],
        earliestDate: DATE,
        latestDate: DATE,
      })
    }

    await unsafeDb.appointmentSegment.deleteMany({
      where: { appointmentId: booking.appointmentId },
    })
    invalidateAvailabilityCache(S)

    await matchWaitlist({
      salonId: S,
      localDate: DATE,
      freedStartMin: at(10),
      freedEndMin: at(13),
      now: NOW,
    })

    // Offering the same slot to both means one of them is being lied to.
    expect(await unsafeDb.waitlistEntry.count({ where: { salonId: S, status: 'OFFERED' } })).toBe(1)
  })

  it('books straight from the held slot when the offer is taken', async () => {
    const blocker = await makeClient('Blocker')
    const waiting = await makeClient('Iris')
    const booking = await fillTheDay(blocker.id)

    const { id } = await joinWaitlist({
      salonId: S,
      clientProfileId: waiting.id,
      serviceIds: ['fc_cut'],
      earliestDate: DATE,
      latestDate: DATE,
    })

    await unsafeDb.appointmentSegment.deleteMany({
      where: { appointmentId: booking.appointmentId },
    })
    invalidateAvailabilityCache(S)
    await matchWaitlist({
      salonId: S,
      localDate: DATE,
      freedStartMin: at(10),
      freedEndMin: at(13),
      now: NOW,
    })

    const accepted = await acceptOffer({ salonId: S, entryId: id, timeZone: TZ })
    const appointment = await unsafeDb.appointment.findUniqueOrThrow({
      where: { id: accepted.appointmentId },
    })

    expect(appointment.source).toBe('WAITLIST')
    expect((await unsafeDb.waitlistEntry.findUniqueOrThrow({ where: { id } })).status).toBe(
      'BOOKED',
    )
  })

  it('is not a way around the consultation gate', async () => {
    const blocker = await makeClient('Blocker')
    const waiting = await makeClient('Juno')
    const booking = await fillTheDay(blocker.id)

    // On the list for a tint, with no patch test on file.
    const { id } = await joinWaitlist({
      salonId: S,
      clientProfileId: waiting.id,
      serviceIds: ['fc_tint'],
      earliestDate: DATE,
      latestDate: DATE,
    })

    await unsafeDb.appointmentSegment.deleteMany({
      where: { appointmentId: booking.appointmentId },
    })
    invalidateAvailabilityCache(S)
    await matchWaitlist({
      salonId: S,
      localDate: DATE,
      freedStartMin: at(10),
      freedEndMin: at(16),
      now: NOW,
    })

    await expect(acceptOffer({ salonId: S, entryId: id, timeZone: TZ })).rejects.toThrow(
      /patch test/i,
    )
  })

  it('declining puts them back on the list and frees the slot', async () => {
    const blocker = await makeClient('Blocker')
    const waiting = await makeClient('Kira')
    const booking = await fillTheDay(blocker.id)

    const { id } = await joinWaitlist({
      salonId: S,
      clientProfileId: waiting.id,
      serviceIds: ['fc_cut'],
      earliestDate: DATE,
      latestDate: DATE,
    })

    await unsafeDb.appointmentSegment.deleteMany({
      where: { appointmentId: booking.appointmentId },
    })
    invalidateAvailabilityCache(S)
    await matchWaitlist({
      salonId: S,
      localDate: DATE,
      freedStartMin: at(10),
      freedEndMin: at(13),
      now: NOW,
    })

    const held = await unsafeDb.waitlistEntry.findUniqueOrThrow({ where: { id } })
    await declineOffer({ salonId: S, entryId: id })

    const after = await unsafeDb.waitlistEntry.findUniqueOrThrow({ where: { id } })
    // Turning down one Tuesday is not the same as no longer wanting an
    // appointment.
    expect(after.status).toBe('OPEN')
    expect(after.offeredHoldId).toBeNull()

    const hold = await unsafeDb.bookingHold.findUniqueOrThrow({
      where: { id: held.offeredHoldId! },
    })
    expect(hold.status).toBe('RELEASED')
  })

  it('reopens an offer nobody answered', async () => {
    const blocker = await makeClient('Blocker')
    const waiting = await makeClient('Lark')
    const booking = await fillTheDay(blocker.id)

    const { id } = await joinWaitlist({
      salonId: S,
      clientProfileId: waiting.id,
      serviceIds: ['fc_cut'],
      earliestDate: DATE,
      latestDate: DATE,
    })

    await unsafeDb.appointmentSegment.deleteMany({
      where: { appointmentId: booking.appointmentId },
    })
    invalidateAvailabilityCache(S)
    await matchWaitlist({
      salonId: S,
      localDate: DATE,
      freedStartMin: at(10),
      freedEndMin: at(13),
      now: NOW,
    })

    await unsafeDb.waitlistEntry.update({
      where: { id },
      data: { offerExpiresAt: new Date(Date.now() - 60_000) },
    })

    /*
     * Without the sweep the entry sits OFFERED forever: the client never gets
     * another offer, the entry never comes back into the pool, and the slot
     * stays held. A waitlist that quietly stops matching is worse than not
     * having one, because the salon believes it is working.
     */
    const { reopened } = await sweepExpiredOffers()
    expect(reopened).toBeGreaterThanOrEqual(1)

    const after = await unsafeDb.waitlistEntry.findUniqueOrThrow({ where: { id } })
    expect(after.status).toBe('OPEN')
    expect(after.offeredHoldId).toBeNull()
  })
})
