import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import {
  cancelTimeOff,
  decideTimeOff,
  requestTimeOff,
  timeOffFor,
} from '@/server/services/time-off'

/**
 * A stylist being somewhere else.
 *
 * The availability solver has pulled every APPROVED `TimeOff` row and
 * subtracted it from the stylist's day since the scheduler was written, and
 * nothing ever created one — so the handling was correct and unreachable, and a
 * salon's only way to stop somebody being booked while they were away was to
 * delete their working hours and remember to put them back.
 */

const S = 'to_salon'
const STYLIST = 'to_sty'
const JUNE = new Date('2026-06-01T00:00:00Z')

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { endsWith: '@to.test' } } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'to-salon',
      name: 'Time Off Test Salon',
      defaultTimezone: 'Europe/London',
      settings: { create: {} },
      locations: { create: { id: 'to_loc', name: 'Main', timezone: 'Europe/London' } },
      serviceCategories: { create: { id: 'to_cat', name: 'Hair', slug: 'hair' } },
      clientProfiles: { create: { id: 'to_cli', firstName: 'Ada', lastName: 'Rivera' } },
    },
  })

  const user = await unsafeDb.user.create({ data: { email: 'sty@to.test', name: 'Nia' } })
  const membership = await unsafeDb.membership.create({
    data: { salonId: S, userId: user.id, role: 'STYLIST' },
  })
  await unsafeDb.stylistProfile.create({
    data: {
      id: STYLIST,
      salonId: S,
      membershipId: membership.id,
      displayName: 'Nia',
      defaultLocationId: 'to_loc',
    },
  })
}

beforeEach(seed)
afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { endsWith: '@to.test' } } })
})

const week = (fromDay: number, toDay: number) => ({
  startsAt: new Date(`2026-06-${String(fromDay).padStart(2, '0')}T00:00:00Z`),
  endsAt: new Date(`2026-06-${String(toDay).padStart(2, '0')}T23:59:59Z`),
})

describe('asking for time off', () => {
  it('starts as a request, which blocks nothing', async () => {
    const { timeOffId } = await requestTimeOff({
      salonId: S,
      stylistProfileId: STYLIST,
      ...week(8, 12),
    })

    const row = await unsafeDb.timeOff.findUniqueOrThrow({ where: { id: timeOffId } })
    expect(row.status).toBe('REQUESTED')

    // Only APPROVED rows reach the solver, so asking costs the salon nothing
    // until somebody agrees to it.
    const visible = await unsafeDb.timeOff.count({ where: { salonId: S, status: 'APPROVED' } })
    expect(visible).toBe(0)
  })

  it('refuses a window that ends before it starts', async () => {
    await expect(
      requestTimeOff({
        salonId: S,
        stylistProfileId: STYLIST,
        startsAt: new Date('2026-06-12T00:00:00Z'),
        endsAt: new Date('2026-06-08T00:00:00Z'),
      }),
    ).rejects.toThrow(/ends before it starts/)
  })

  it('refuses a second request over the same days', async () => {
    /*
     * Two rows covering one afternoon means approving one and denying the other
     * leaves the day half blocked, and nothing on the screen says which is in
     * force.
     */
    await requestTimeOff({ salonId: S, stylistProfileId: STYLIST, ...week(8, 12) })
    await expect(
      requestTimeOff({ salonId: S, stylistProfileId: STYLIST, ...week(10, 15) }),
    ).rejects.toThrow(/already have time off/)
  })

  it('allows a second request that does not overlap', async () => {
    await requestTimeOff({ salonId: S, stylistProfileId: STYLIST, ...week(8, 12) })
    await expect(
      requestTimeOff({ salonId: S, stylistProfileId: STYLIST, ...week(15, 19) }),
    ).resolves.toBeTruthy()
  })

  it('refuses a stylist from another salon', async () => {
    await expect(
      requestTimeOff({ salonId: S, stylistProfileId: 'someone_else', ...week(8, 12) }),
    ).rejects.toThrow(/not here/)
  })
})

describe('deciding', () => {
  it('approving is what takes them out of the diary', async () => {
    const { timeOffId } = await requestTimeOff({
      salonId: S,
      stylistProfileId: STYLIST,
      ...week(8, 12),
    })

    expect(await decideTimeOff({ salonId: S, timeOffId, approve: true })).toMatchObject({
      status: 'APPROVED',
    })

    // The shape the solver actually queries for.
    const blocking = await unsafeDb.timeOff.findMany({
      where: { salonId: S, status: 'APPROVED', startsAt: { lt: new Date('2026-06-30T00:00:00Z') } },
    })
    expect(blocking).toHaveLength(1)
  })

  it('turning it down leaves the diary alone', async () => {
    const { timeOffId } = await requestTimeOff({
      salonId: S,
      stylistProfileId: STYLIST,
      ...week(8, 12),
    })
    await decideTimeOff({ salonId: S, timeOffId, approve: false })

    expect(await unsafeDb.timeOff.count({ where: { salonId: S, status: 'APPROVED' } })).toBe(0)
  })

  it('refuses a request from another salon', async () => {
    await expect(
      decideTimeOff({ salonId: S, timeOffId: 'not_ours', approve: true }),
    ).rejects.toThrow(/not here/)
  })
})

describe('what is already booked in the window', () => {
  /*
   * Bare appointment, no service rows: the clash count is a question about the
   * stylist's time, not about what was booked into it.
   */
  async function bookInside() {
    await unsafeDb.appointment.create({
      data: {
        salonId: S,
        locationId: 'to_loc',
        clientProfileId: 'to_cli',
        primaryStylistId: STYLIST,
        status: 'CONFIRMED',
        startsAt: new Date('2026-06-09T10:00:00Z'),
        endsAt: new Date('2026-06-09T11:00:00Z'),
        estimatedTotalCents: 5_000,
        estimatedDurationMin: 60,
      },
    })
  }

  it('counts the clients who need ringing rather than refusing', async () => {
    /*
     * Somebody being ill on a Friday is exactly when this has to be approvable.
     * What a manager needs is the number of people to ring, not a wall.
     */
    await bookInside()
    const { clashes } = await requestTimeOff({
      salonId: S,
      stylistProfileId: STYLIST,
      ...week(8, 12),
    })
    expect(clashes).toBe(1)
  })

  it('carries the count onto the list, so it is visible before deciding', async () => {
    await bookInside()
    await requestTimeOff({ salonId: S, stylistProfileId: STYLIST, ...week(8, 12) })

    const rows = await timeOffFor(S, { from: JUNE })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.clashes).toBe(1)
    expect(rows[0]?.stylistName).toBe('Nia')
  })
})

describe('taking it back', () => {
  it('removes it, and frees the days again', async () => {
    const { timeOffId } = await requestTimeOff({
      salonId: S,
      stylistProfileId: STYLIST,
      ...week(8, 12),
    })
    await decideTimeOff({ salonId: S, timeOffId, approve: true })
    await cancelTimeOff({ salonId: S, timeOffId })

    expect(await unsafeDb.timeOff.count({ where: { salonId: S } })).toBe(0)
  })

  it('refuses to remove another salon’s', async () => {
    await expect(cancelTimeOff({ salonId: S, timeOffId: 'not_ours' })).rejects.toThrow(/not here/)
  })
})

describe('the list', () => {
  it('leaves out time that has already finished', async () => {
    await unsafeDb.timeOff.create({
      data: {
        salonId: S,
        stylistProfileId: STYLIST,
        startsAt: new Date('2026-01-05T00:00:00Z'),
        endsAt: new Date('2026-01-09T00:00:00Z'),
        status: 'APPROVED',
      },
    })
    await requestTimeOff({ salonId: S, stylistProfileId: STYLIST, ...week(8, 12) })

    // Past holiday is history nobody acts on; this screen is for deciding.
    const rows = await timeOffFor(S, { from: JUNE })
    expect(rows).toHaveLength(1)
  })

  it('narrows to one stylist when asked', async () => {
    await requestTimeOff({ salonId: S, stylistProfileId: STYLIST, ...week(8, 12) })

    expect(await timeOffFor(S, { stylistProfileId: STYLIST, from: JUNE })).toHaveLength(1)
    expect(await timeOffFor(S, { stylistProfileId: 'nobody', from: JUNE })).toHaveLength(0)
  })
})
