import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import {
  bookFromHold,
  createHold,
  cancelAppointment,
  SlotTakenError,
} from '@/server/services/scheduling/booking'
import { computeAvailability } from '@/domain/scheduling/availability'
import { buildChain } from '@/domain/scheduling/chain'
import {
  loadAvailabilityRequest,
  invalidateAvailabilityCache,
} from '@/server/services/scheduling/loader'
import {
  fromEpochMinutes,
  localTimeToEpochMinutes,
  toEpochMinutes,
} from '@/domain/scheduling/zoned'
import type { PhaseChain, Slot } from '@/domain/scheduling/types'

/**
 * Booking safety, against a real Postgres.
 *
 * The exclusion constraint is the guarantee the whole product rests on, so it
 * is tested by actually racing writers rather than by reasoning about it.
 */

const S = 'bk_salon'
const TZ = 'America/New_York'
const DATE = '2026-07-13' // a Monday
const at = (h: number, m = 0) => localTimeToEpochMinutes(DATE, h * 60 + m, TZ)

const SETTINGS = {
  slotGranularityMin: 15,
  minBookingLeadMin: 0,
  maxAdvanceDays: 365,
  allowFinishAfterCloseMin: 0,
  interleaveEnabled: false,
  maxConcurrentClients: 2,
  minInterleaveMin: 25,
}

const CHAIN: PhaseChain = buildChain(
  [
    {
      serviceId: 'bk_svc',
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      phases: [
        {
          kind: 'ACTIVE',
          label: 'Colour',
          durationMin: 60,
          requiresStylist: true,
          requiresResourceType: 'CHAIR',
          isScalable: true,
        },
      ],
    },
  ],
  { settings: SETTINGS },
)

function slotAt(hour: number, stylistId = 'bk_sty', chairId = 'bk_chair'): Slot {
  return {
    startMin: at(hour),
    endMin: at(hour + 1),
    stylistId,
    localDate: DATE,
    placements: [
      {
        index: 0,
        kind: 'ACTIVE',
        label: 'Colour',
        interval: { start: at(hour), end: at(hour + 1) },
        resourceId: chairId,
      },
    ],
    offersInterleave: false,
    score: 1,
  }
}

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'bk-' } } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'bk-salon',
      name: 'Booking Test Salon',
      defaultTimezone: TZ,
      settings: { create: { ...SETTINGS } },
      locations: { create: { id: 'bk_loc', name: 'Main', timezone: TZ } },
      serviceCategories: { create: { id: 'bk_cat', name: 'Colour', slug: 'colour' } },
    },
  })

  await unsafeDb.resource.create({
    data: { id: 'bk_chair', salonId: S, locationId: 'bk_loc', type: 'CHAIR', name: 'Chair 1' },
  })
  await unsafeDb.resource.create({
    data: { id: 'bk_chair2', salonId: S, locationId: 'bk_loc', type: 'CHAIR', name: 'Chair 2' },
  })

  await unsafeDb.user.create({ data: { id: 'bk_user', email: 'bk-sty@example.com' } })
  await unsafeDb.membership.create({
    data: { id: 'bk_mem', salonId: S, userId: 'bk_user', role: 'STYLIST' },
  })
  await unsafeDb.stylistProfile.create({
    data: { id: 'bk_sty', salonId: S, membershipId: 'bk_mem', displayName: 'Rowan' },
  })

  await unsafeDb.workingHours.create({
    data: { salonId: S, locationId: 'bk_loc', dayOfWeek: 1, startMinute: 540, endMinute: 1020 },
  })
  await unsafeDb.workingHours.create({
    data: {
      salonId: S,
      stylistProfileId: 'bk_sty',
      dayOfWeek: 1,
      startMinute: 540,
      endMinute: 1020,
    },
  })

  await unsafeDb.service.create({
    data: {
      id: 'bk_svc',
      salonId: S,
      categoryId: 'bk_cat',
      name: 'Colour',
      slug: 'colour',
      basePriceCents: 12000,
      isChemical: true,
      phases: {
        create: {
          salonId: S,
          sequence: 0,
          kind: 'ACTIVE',
          label: 'Colour',
          durationMin: 60,
          requiresStylist: true,
          requiresResourceType: 'CHAIR',
        },
      },
    },
  })

  for (const n of [1, 2, 3]) {
    await unsafeDb.clientProfile.create({
      data: { id: `bk_cli_${n}`, salonId: S, firstName: 'Client', lastName: String(n) },
    })
  }
}

beforeAll(seed, 90_000)

beforeEach(async () => {
  await unsafeDb.appointmentSegment.deleteMany({ where: { salonId: S } })
  await unsafeDb.deposit.deleteMany({ where: { salonId: S } })
  await unsafeDb.appointment.deleteMany({ where: { salonId: S } })
  await unsafeDb.bookingHold.deleteMany({ where: { salonId: S } })
  await unsafeDb.outbox.deleteMany({ where: { salonId: S } })
  invalidateAvailabilityCache(S)
})

afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'bk-' } } })
  await unsafeDb.$disconnect()
})

const services = [{ serviceId: 'bk_svc', plannedDurationMin: 60, priceCents: 12000 }]

const holdInput = (slot: Slot, client: string) => ({
  salonId: S,
  locationId: 'bk_loc',
  clientProfileId: client,
  slot,
  chain: CHAIN,
  ttlSeconds: 900,
})

describe('holds', () => {
  it('reserves the slot at the storage layer', async () => {
    const { holdId } = await createHold(holdInput(slotAt(10), 'bk_cli_1'))
    const segments = await unsafeDb.appointmentSegment.findMany({
      where: { bookingHoldId: holdId },
    })
    expect(segments).toHaveLength(1)
    expect(segments[0]!.state).toBe('HOLD')
  })

  it('a second hold on the same slot is refused', async () => {
    await createHold(holdInput(slotAt(10), 'bk_cli_1'))
    await expect(createHold(holdInput(slotAt(10), 'bk_cli_2'))).rejects.toThrow(SlotTakenError)
  })

  it('a hold on an adjacent slot succeeds — half-open ranges', async () => {
    await createHold(holdInput(slotAt(10), 'bk_cli_1'))
    await expect(createHold(holdInput(slotAt(11), 'bk_cli_2'))).resolves.toBeDefined()
  })

  it('releasing frees the slot', async () => {
    const { holdId } = await createHold(holdInput(slotAt(10), 'bk_cli_1'))
    const { releaseHold } = await import('@/server/services/scheduling/booking')
    await releaseHold(S, holdId)
    await expect(createHold(holdInput(slotAt(10), 'bk_cli_2'))).resolves.toBeDefined()
  })

  it('an idempotency key returns the same hold rather than a second one', async () => {
    const input = { ...holdInput(slotAt(10), 'bk_cli_1'), idempotencyKey: 'same-key' }
    const first = await createHold(input)
    const second = await createHold(input)
    expect(second.holdId).toBe(first.holdId)
    expect(await unsafeDb.bookingHold.count({ where: { salonId: S } })).toBe(1)
  })

  // An exclusion constraint cannot reference now(), so an expired hold keeps
  // blocking until something removes it. This is that something.
  it('an expired hold is purged opportunistically by the next contender', async () => {
    const { holdId } = await createHold(holdInput(slotAt(10), 'bk_cli_1'))
    await unsafeDb.bookingHold.update({
      where: { id: holdId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })
    await unsafeDb.appointmentSegment.updateMany({
      where: { bookingHoldId: holdId },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    })

    await expect(createHold(holdInput(slotAt(10), 'bk_cli_2'))).resolves.toBeDefined()
  })
})

describe('booking', () => {
  it('promotes the hold’s segments rather than recreating them', async () => {
    const { holdId } = await createHold(holdInput(slotAt(10), 'bk_cli_1'))
    const before = await unsafeDb.appointmentSegment.findFirst({ where: { bookingHoldId: holdId } })

    const result = await bookFromHold({
      salonId: S,
      holdId,
      clientProfileId: 'bk_cli_1',
      services,
      timeZone: TZ,
    })

    // Cleared off the hold so a racing releaseHold cannot delete them.
    const after = await unsafeDb.appointmentSegment.findFirst({
      where: { appointmentId: result.appointmentId },
    })
    // Same row, promoted — no window where the slot was free.
    expect(after!.id).toBe(before!.id)
    expect(after!.state).toBe('ACTIVE')
    expect(after!.appointmentId).toBe(result.appointmentId)
    expect(after!.bookingHoldId).toBeNull()
    expect(after!.holdExpiresAt).toBeNull()
  })

  it('releasing a consumed hold does not delete the booked segments', async () => {
    const { holdId } = await createHold(holdInput(slotAt(10), 'bk_cli_1'))
    const result = await bookFromHold({
      salonId: S,
      holdId,
      clientProfileId: 'bk_cli_1',
      services,
      timeZone: TZ,
    })

    const { releaseHold } = await import('@/server/services/scheduling/booking')
    await releaseHold(S, holdId)

    const segments = await unsafeDb.appointmentSegment.findMany({
      where: { appointmentId: result.appointmentId },
    })
    expect(segments.length).toBeGreaterThan(0)
    expect(segments.every((s) => s.state === 'ACTIVE')).toBe(true)
    expect((await unsafeDb.bookingHold.findUniqueOrThrow({ where: { id: holdId } })).status).toBe(
      'CONSUMED',
    )
  })

  it('writes an outbox event in the same transaction', async () => {
    const { holdId } = await createHold(holdInput(slotAt(10), 'bk_cli_1'))
    await bookFromHold({ salonId: S, holdId, clientProfileId: 'bk_cli_1', services, timeZone: TZ })

    const events = await unsafeDb.outbox.findMany({
      where: { salonId: S, topic: 'appointment.booked' },
    })
    expect(events).toHaveLength(1)
  })

  it('creates a deposit when one is required', async () => {
    const { holdId } = await createHold(holdInput(slotAt(10), 'bk_cli_1'))
    await bookFromHold({
      salonId: S,
      holdId,
      clientProfileId: 'bk_cli_1',
      services,
      depositCents: 4500,
      timeZone: TZ,
    })
    const deposit = await unsafeDb.deposit.findFirst({ where: { salonId: S } })
    expect(deposit?.amountCents).toBe(4500)
  })

  it('refuses to book the same hold twice', async () => {
    const { holdId } = await createHold(holdInput(slotAt(10), 'bk_cli_1'))
    await bookFromHold({ salonId: S, holdId, clientProfileId: 'bk_cli_1', services, timeZone: TZ })
    await expect(
      bookFromHold({ salonId: S, holdId, clientProfileId: 'bk_cli_2', services, timeZone: TZ }),
    ).rejects.toThrow(/already been booked/)
  })

  it('refuses an expired hold', async () => {
    const { holdId } = await createHold(holdInput(slotAt(10), 'bk_cli_1'))
    await unsafeDb.bookingHold.update({
      where: { id: holdId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    await expect(
      bookFromHold({ salonId: S, holdId, clientProfileId: 'bk_cli_1', services, timeZone: TZ }),
    ).rejects.toThrow(/expired/)
  })
})

describe('the booking race', () => {
  // The headline guarantee. Twenty-five writers, one slot, separate
  // transactions — exactly one may win.
  it('exactly one of 25 concurrent holds on one slot succeeds', async () => {
    const attempts = Array.from({ length: 25 }, (_, n) =>
      createHold(holdInput(slotAt(13), `bk_cli_${(n % 3) + 1}`)),
    )

    const results = await Promise.allSettled(attempts)
    const won = results.filter((r) => r.status === 'fulfilled')
    const lost = results.filter((r) => r.status === 'rejected')

    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(24)
    for (const failure of lost) {
      expect((failure as PromiseRejectedResult).reason).toBeInstanceOf(SlotTakenError)
    }

    const segments = await unsafeDb.appointmentSegment.findMany({
      where: { salonId: S, startsAt: fromEpochMinutes(at(13)) },
    })
    expect(segments).toHaveLength(1)
  })

  it('concurrent holds on DIFFERENT slots all succeed', async () => {
    const results = await Promise.allSettled(
      [9, 10, 11, 12, 13, 14, 15].map((h) => createHold(holdInput(slotAt(h), 'bk_cli_1'))),
    )
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
  })

  it('a processing segment may overlap another client’s active work', async () => {
    // Interleaving, proven at the storage layer rather than argued for.
    await createHold(holdInput(slotAt(10), 'bk_cli_1'))

    const overlappingProcessing = await unsafeDb.appointmentSegment.create({
      data: {
        salonId: S,
        locationId: 'bk_loc',
        stylistProfileId: 'bk_sty',
        kind: 'PROCESSING',
        startsAt: fromEpochMinutes(at(10, 15)),
        endsAt: fromEpochMinutes(at(10, 45)),
        blocksStylist: false,
        blocksResource: false,
        state: 'ACTIVE',
      },
    })
    expect(overlappingProcessing.id).toBeTruthy()
  })

  it('two clients cannot take the same chair even with different stylists', async () => {
    await unsafeDb.user.create({ data: { id: 'bk_user2', email: 'bk-sty2@example.com' } })
    await unsafeDb.membership.create({
      data: { id: 'bk_mem2', salonId: S, userId: 'bk_user2', role: 'STYLIST' },
    })
    await unsafeDb.stylistProfile.create({
      data: { id: 'bk_sty2', salonId: S, membershipId: 'bk_mem2', displayName: 'Sam' },
    })

    await createHold(holdInput(slotAt(10, 'bk_sty', 'bk_chair'), 'bk_cli_1'))
    await expect(
      createHold(holdInput(slotAt(10, 'bk_sty2', 'bk_chair'), 'bk_cli_2')),
    ).rejects.toThrow(SlotTakenError)

    // A different chair is fine.
    await expect(
      createHold(holdInput(slotAt(10, 'bk_sty2', 'bk_chair2'), 'bk_cli_2')),
    ).resolves.toBeDefined()

    await unsafeDb.stylistProfile.delete({ where: { id: 'bk_sty2' } })
    await unsafeDb.membership.delete({ where: { id: 'bk_mem2' } })
    await unsafeDb.user.delete({ where: { id: 'bk_user2' } })
  })
})

describe('cancellation', () => {
  it('frees the time immediately so it can be resold', async () => {
    const { holdId } = await createHold(holdInput(slotAt(10), 'bk_cli_1'))
    const { appointmentId } = await bookFromHold({
      salonId: S,
      holdId,
      clientProfileId: 'bk_cli_1',
      services,
      timeZone: TZ,
    })

    await cancelAppointment({ salonId: S, appointmentId, reason: 'Client rescheduled' })

    expect(await unsafeDb.appointmentSegment.count({ where: { appointmentId } })).toBe(0)
    await expect(createHold(holdInput(slotAt(10), 'bk_cli_2'))).resolves.toBeDefined()
  })

  it('records a no-show distinctly from a cancellation', async () => {
    const { holdId } = await createHold(holdInput(slotAt(10), 'bk_cli_1'))
    const { appointmentId } = await bookFromHold({
      salonId: S,
      holdId,
      clientProfileId: 'bk_cli_1',
      services,
      timeZone: TZ,
    })

    await cancelAppointment({ salonId: S, appointmentId, markNoShow: true })
    const appointment = await unsafeDb.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
    })
    expect(appointment.status).toBe('NO_SHOW')
    expect(appointment.noShowAt).not.toBeNull()
  })
})

describe('loader and solver agree', () => {
  // The invariant that matters end to end: everything the solver offers, given
  // real data, must actually survive being booked.
  it('every slot the solver offers can be held', async () => {
    await createHold(holdInput(slotAt(11), 'bk_cli_1'))

    const request = await loadAvailabilityRequest({
      salonId: S,
      locationId: 'bk_loc',
      fromDate: DATE,
      toDate: DATE,
      chain: CHAIN,
      requiredSkill: null,
      isChemical: true,
      isNewClient: false,
      now: fromEpochMinutes(at(8)),
    })

    const result = computeAvailability({ ...request, maxPerDay: 100 })
    expect(result.slots.length).toBeGreaterThan(0)

    // Nothing offered may collide with the existing 11:00 hold.
    for (const slot of result.slots) {
      const clashes = slot.startMin < at(12) && at(11) < slot.endMin
      expect(clashes, `offered a slot at ${slot.startMin} overlapping the 11:00 hold`).toBe(false)
    }

    // And the first one really can be taken.
    await expect(createHold(holdInput(result.slots[0]!, 'bk_cli_2'))).resolves.toBeDefined()
  })

  it('the loader reflects the salon timezone', async () => {
    const request = await loadAvailabilityRequest({
      salonId: S,
      locationId: 'bk_loc',
      fromDate: DATE,
      toDate: DATE,
      chain: CHAIN,
      requiredSkill: null,
      isChemical: false,
      isNewClient: false,
      now: fromEpochMinutes(at(8)),
    })

    expect(request.timeZone).toBe(TZ)
    const open = request.openIntervals[DATE]!
    expect(open).toHaveLength(1)
    expect(toEpochMinutes(fromEpochMinutes(open[0]!.start))).toBe(at(9))
    expect(open[0]!.end).toBe(at(17))
  })
})
