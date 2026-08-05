import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { findSlots, resolveSlot } from '@/server/services/scheduling/slots'
import { invalidateAvailabilityCache } from '@/server/services/scheduling/loader'
import { reviewConsultation } from '@/server/services/service-plan'
import { evaluateConsultation, saveAnswer, startConsultation } from '@/server/services/consultation'
import { localDateOf } from '@/domain/scheduling/zoned'
import { maskOf } from '@/domain/scheduling/window'

/**
 * "Approve, but Tuesdays and Thursdays, mornings only."
 *
 * A real thing a colourist says about a five-hour correction, and until this
 * there was nowhere to put it: availability was auto-computed from the diary
 * and the client got all of it. The narrowing has to survive the whole way
 * from the decision panel to the hold — a restriction the search honours but
 * the hold does not is worse than none, because it fails at the last tap.
 */

const S = 'bw_salon'
const TZ = 'America/New_York'

/*
 * Anchored to a fixed Monday rather than "today". Every assertion here is about
 * which weekday a slot lands on, and a suite that quietly passes six days a
 * week is not a test.
 */
const MONDAY = '2026-09-07'
const TUESDAY = '2026-09-08'
const NOW = new Date(`${MONDAY}T08:00:00-04:00`)

async function seed() {
  await unsafeDb.servicePlan.deleteMany({ where: { salonId: S } })
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'bw-' } } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'bw-salon',
      name: 'Window Test Salon',
      defaultTimezone: TZ,
      settings: {
        create: {
          slotGranularityMin: 30,
          minBookingLeadMin: 0,
          maxAdvanceDays: 365,
          allowFinishAfterCloseMin: 0,
        },
      },
      locations: { create: { id: 'bw_loc', name: 'Main', timezone: TZ } },
      serviceCategories: { create: { id: 'bw_cat', name: 'Colour', slug: 'colour' } },
    },
  })

  await unsafeDb.resource.create({
    data: { id: 'bw_chair', salonId: S, locationId: 'bw_loc', type: 'CHAIR', name: 'Chair 1' },
  })

  await unsafeDb.user.create({ data: { id: 'bw_user', email: 'bw-sty@example.com' } })
  await unsafeDb.membership.create({
    data: { id: 'bw_mem', salonId: S, userId: 'bw_user', role: 'STYLIST' },
  })
  await unsafeDb.stylistProfile.create({
    data: { id: 'bw_sty', salonId: S, membershipId: 'bw_mem', displayName: 'Rowan' },
  })

  // Open every day, 9 to 5, so anything the tests exclude was excluded by the
  // window and not by the rota.
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    await unsafeDb.workingHours.create({
      data: { salonId: S, locationId: 'bw_loc', dayOfWeek, startMinute: 540, endMinute: 1020 },
    })
    await unsafeDb.workingHours.create({
      data: {
        salonId: S,
        stylistProfileId: 'bw_sty',
        dayOfWeek,
        startMinute: 540,
        endMinute: 1020,
      },
    })
  }

  await unsafeDb.service.create({
    data: {
      id: 'bw_svc',
      salonId: S,
      categoryId: 'bw_cat',
      name: 'Gloss',
      slug: 'gloss',
      basePriceCents: 7500,
      baseComplexity: 2,
      phases: {
        create: {
          salonId: S,
          sequence: 0,
          kind: 'ACTIVE',
          label: 'Colour',
          durationMin: 60,
          requiresStylist: true,
          requiresResourceType: 'CHAIR',
          isScalable: true,
        },
      },
    },
  })
  await unsafeDb.stylistService.create({
    data: { salonId: S, stylistProfileId: 'bw_sty', serviceId: 'bw_svc', isEnabled: true },
  })

  const template = await unsafeDb.consultationTemplate.create({
    data: { salonId: S, key: 'bw-tpl', version: 1, name: 'Colour', status: 'PUBLISHED' },
  })
  await unsafeDb.consultationQuestion.create({
    data: {
      salonId: S,
      templateId: template.id,
      key: 'goal',
      section: 'Goal',
      sortOrder: 0,
      prompt: 'Target level?',
      inputType: 'LEVEL_PICKER',
      factKey: 'goal.targetLevel',
      isRequired: true,
    },
  })

  await unsafeDb.clientProfile.create({
    data: { id: 'bw_cli', salonId: S, firstName: 'Ada', lastName: 'Byron', completedVisits: 4 },
  })
}

/** Approve a fresh consultation, optionally narrowed. */
async function approve(window?: {
  earliestDate?: string | null
  latestDate?: string | null
  dayOfWeekMask?: number
  windowStartMinute?: number
  windowEndMinute?: number
}) {
  const consultationId = await startConsultation({
    salonId: S,
    clientProfileId: 'bw_cli',
    serviceIds: ['bw_svc'],
    stylistProfileId: 'bw_sty',
  })
  await saveAnswer({
    salonId: S,
    consultationId,
    questionKey: 'goal',
    value: { level: 6, tone: 'NATURAL_DARK_BLONDE' },
  })
  await evaluateConsultation({ salonId: S, consultationId })

  const { servicePlanId } = await reviewConsultation({
    salonId: S,
    consultationId,
    reviewerUserId: 'bw_user',
    decision: 'APPROVE',
    overrides: window
      ? {
          window: {
            earliestDate: window.earliestDate ?? null,
            latestDate: window.latestDate ?? null,
            dayOfWeekMask: window.dayOfWeekMask ?? 127,
            windowStartMinute: window.windowStartMinute ?? 0,
            windowEndMinute: window.windowEndMinute ?? 1440,
          },
        }
      : undefined,
  })
  return servicePlanId!
}

const searchFor = (servicePlanId: string, days = 14) =>
  findSlots({
    salonId: S,
    servicePlanId,
    sequence: 1,
    fromDate: MONDAY,
    toDate: addDays(MONDAY, days),
    now: NOW,
  })

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const weekdayOf = (isoInstant: string) =>
  new Date(`${localDateOf(new Date(isoInstant), TZ)}T00:00:00Z`).getUTCDay()

beforeAll(seed, 90_000)

beforeEach(() => {
  // The loader caches for twenty seconds; these tests run in far less.
  invalidateAvailabilityCache(S)
})

afterAll(async () => {
  await unsafeDb.servicePlan.deleteMany({ where: { salonId: S } })
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'bw-' } } })
  await unsafeDb.$disconnect()
})

describe('an approval that narrows nothing', () => {
  it('offers the whole open diary, as it always did', async () => {
    const result = await searchFor(await approve())
    expect(result.slots.length).toBeGreaterThan(0)
    expect(result.restrictedTo).toBeNull()
    // Both a Monday and a Tuesday in the range.
    expect(new Set(result.slots.map((s) => weekdayOf(s.startsAt))).size).toBeGreaterThan(1)
  })
})

describe('an approval held to certain days', () => {
  it('offers only those days', async () => {
    // Tuesday = 2, Thursday = 4.
    const planId = await approve({ dayOfWeekMask: maskOf([2, 4]) })
    const result = await searchFor(planId)

    expect(result.slots.length).toBeGreaterThan(0)
    for (const slot of result.slots) {
      expect([2, 4]).toContain(weekdayOf(slot.startsAt))
    }
  })

  it('persists the narrowing on the plan rather than only honouring it once', async () => {
    const planId = await approve({ dayOfWeekMask: maskOf([2]) })
    const row = await unsafeDb.servicePlan.findUniqueOrThrow({
      where: { id: planId },
      select: { dayOfWeekMask: true },
    })
    expect(row.dayOfWeekMask).toBe(maskOf([2]))
  })

  /*
   * The client's own search cannot widen it back out. A stylist narrowing an
   * approval is making a clinical decision about somebody's hair, not
   * expressing a preference — so the window comes off the plan, never off the
   * request.
   */
  it('cannot be dropped by a search that simply does not mention it', async () => {
    const planId = await approve({ dayOfWeekMask: maskOf([2]) })
    const result = await findSlots({
      salonId: S,
      servicePlanId: planId,
      sequence: 1,
      fromDate: MONDAY,
      toDate: addDays(MONDAY, 14),
      anyStylist: true,
      now: NOW,
    })
    expect(result.slots.every((s) => weekdayOf(s.startsAt) === 2)).toBe(true)
  })
})

describe('an approval held to a time of day', () => {
  it('offers only starts inside it', async () => {
    const planId = await approve({ windowStartMinute: 9 * 60, windowEndMinute: 11 * 60 })
    const result = await searchFor(planId)

    expect(result.slots.length).toBeGreaterThan(0)
    for (const slot of result.slots) {
      const hour = Number(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: TZ,
          hour: '2-digit',
          hour12: false,
        }).format(new Date(slot.startsAt)),
      )
      expect(hour).toBeGreaterThanOrEqual(9)
      expect(hour).toBeLessThanOrEqual(11)
    }
  })
})

describe('an approval held to a date range', () => {
  it('stops at the last date', async () => {
    const planId = await approve({ latestDate: TUESDAY })
    const result = await searchFor(planId)

    expect(result.slots.length).toBeGreaterThan(0)
    for (const slot of result.slots) {
      expect(localDateOf(new Date(slot.startsAt), TZ) <= TUESDAY).toBe(true)
    }
  })
})

describe('what the client is told', () => {
  it('is given the narrowing in words rather than left to guess', async () => {
    const planId = await approve({ dayOfWeekMask: maskOf([2]), windowStartMinute: 540 })
    const result = await searchFor(planId)
    expect(result.restrictedTo).toContain('Tues')
    expect(result.restrictedTo).toContain('9am')
  })

  /*
   * Without this a client reads "no times in that range" as the salon being
   * full, widens the range, and gets the same answer back — repeatedly, against
   * something no amount of widening will move.
   */
  it('names the restriction when the search comes back empty', async () => {
    // Tuesdays only, searched across a Sunday-to-Monday range with no Tuesday.
    const planId = await approve({ dayOfWeekMask: maskOf([2]) })
    const result = await findSlots({
      salonId: S,
      servicePlanId: planId,
      sequence: 1,
      fromDate: MONDAY,
      toDate: MONDAY,
      now: NOW,
    })
    expect(result.slots).toHaveLength(0)
    expect(result.reason).toContain('Tues')
  })
})

describe('holding a slot outside the window', () => {
  it('is refused, because the token is not the authority', async () => {
    // A slot found before any narrowing existed…
    const open = await approve()
    const found = await searchFor(open)
    const monday = found.slots.find((s) => weekdayOf(s.startsAt) === 1)
    expect(monday, 'a Monday was offered by the open plan').toBeTruthy()

    // …offered against a plan that has since been held to Tuesdays.
    await unsafeDb.servicePlan.update({
      where: { id: open },
      data: { dayOfWeekMask: maskOf([2]) },
    })
    invalidateAvailabilityCache(S)

    const resolved = await resolveSlot({
      salonId: S,
      servicePlanId: open,
      sequence: 1,
      fromDate: MONDAY,
      toDate: MONDAY,
      token: monday!.token,
      now: NOW,
    })

    // Never solved, so there is nothing to match and no hold to write.
    expect(resolved).toBeNull()
  })

  it('still resolves a slot inside the window', async () => {
    const planId = await approve({ dayOfWeekMask: maskOf([2]) })
    const found = await searchFor(planId)
    expect(found.slots.length).toBeGreaterThan(0)

    const resolved = await resolveSlot({
      salonId: S,
      servicePlanId: planId,
      sequence: 1,
      fromDate: MONDAY,
      toDate: addDays(MONDAY, 14),
      token: found.slots[0]!.token,
      now: NOW,
    })
    expect(resolved).not.toBeNull()
  })
})

describe('the database refusing a window nobody could book', () => {
  it('rejects a start that comes after its end', async () => {
    const planId = await approve()
    await expect(
      unsafeDb.servicePlan.update({
        where: { id: planId },
        data: { windowStartMinute: 900, windowEndMinute: 600 },
      }),
    ).rejects.toThrow()
  })

  // Zero days is not a narrowing, it is an outage: the client would be told the
  // salon is fully booked, forever.
  it('rejects a mask with no days in it', async () => {
    const planId = await approve()
    await expect(
      unsafeDb.servicePlan.update({ where: { id: planId }, data: { dayOfWeekMask: 0 } }),
    ).rejects.toThrow()
  })
})
