import { unsafeDb } from '@/server/db/client'
import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import { invalidateAvailabilityCache } from '@/server/services/scheduling/loader'

/**
 * A stylist being somewhere else.
 *
 * `TimeOff` has been read by the availability solver since the scheduler was
 * written — `loader.ts` pulls every APPROVED row and subtracts it from the
 * stylist's day — and nothing has ever created one. So the solver's handling of
 * holiday was correct and unreachable, and a salon's only way to stop a stylist
 * being booked while they were away was to delete their working hours and put
 * them back afterwards.
 *
 * Requested and approved separately because that is how it actually works in a
 * salon: a stylist asks, somebody who owns the diary decides. Only APPROVED
 * time blocks the calendar, so asking never silently costs the salon bookings
 * before anybody has agreed to it.
 */

export interface TimeOffRow {
  id: string
  stylistProfileId: string
  stylistName: string
  startsAt: Date
  endsAt: Date
  allDay: boolean
  reason: string | null
  status: string
  /** Appointments already in the diary inside the requested window. */
  clashes: number
}

/**
 * What is booked inside a window, counted rather than blocked.
 *
 * Approving time off over an existing appointment is a real thing a manager
 * does — somebody is ill and the clients have to be moved — so this refuses
 * nothing. It says how many people need ringing, which is the number the
 * decision actually turns on.
 */
async function clashesFor(
  salonId: string,
  stylistProfileId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<number> {
  return unsafeDb.appointment.count({
    where: {
      salonId,
      primaryStylistId: stylistProfileId,
      status: { in: ['BOOKED', 'CONFIRMED', 'IN_CHAIR', 'PROCESSING'] },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
  })
}

export async function timeOffFor(
  salonId: string,
  opts: { stylistProfileId?: string; from?: Date } = {},
): Promise<TimeOffRow[]> {
  const from = opts.from ?? new Date()

  const rows = await dbFor(salonId).timeOff.findMany({
    where: {
      salonId,
      ...(opts.stylistProfileId ? { stylistProfileId: opts.stylistProfileId } : {}),
      // Past holiday is history nobody acts on; the screen is for deciding.
      endsAt: { gte: from },
    },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      stylistProfileId: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      reason: true,
      status: true,
      stylistProfile: { select: { displayName: true } },
    },
  })

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      stylistProfileId: row.stylistProfileId,
      stylistName: row.stylistProfile.displayName,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      allDay: row.allDay,
      reason: row.reason,
      status: row.status,
      clashes:
        row.status === 'DENIED'
          ? 0
          : await clashesFor(salonId, row.stylistProfileId, row.startsAt, row.endsAt),
    })),
  )
}

export async function requestTimeOff(input: {
  salonId: string
  stylistProfileId: string
  startsAt: Date
  endsAt: Date
  allDay?: boolean
  reason?: string | null
}): Promise<{ timeOffId: string; clashes: number }> {
  if (input.endsAt <= input.startsAt) {
    throw new DomainError('INVALID_INPUT', 'That ends before it starts.')
  }

  const stylist = await dbFor(input.salonId).stylistProfile.findFirst({
    where: { id: input.stylistProfileId, salonId: input.salonId },
    select: { id: true },
  })
  if (!stylist) throw new DomainError('NOT_FOUND', 'That stylist is not here.')

  /*
   * Overlapping requests are refused rather than merged. Two rows covering the
   * same afternoon means approving one and denying the other leaves the day
   * half-blocked, and nobody can tell from the screen which is in force.
   */
  const overlapping = await unsafeDb.timeOff.findFirst({
    where: {
      salonId: input.salonId,
      stylistProfileId: input.stylistProfileId,
      status: { in: ['REQUESTED', 'APPROVED'] },
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
    },
    select: { id: true },
  })
  if (overlapping) {
    throw new DomainError('CONFLICT', 'They already have time off over some of that.')
  }

  const created = await unsafeDb.timeOff.create({
    data: {
      salonId: input.salonId,
      stylistProfileId: input.stylistProfileId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      allDay: input.allDay ?? false,
      reason: input.reason ?? null,
      status: 'REQUESTED',
    },
    select: { id: true },
  })

  return {
    timeOffId: created.id,
    clashes: await clashesFor(
      input.salonId,
      input.stylistProfileId,
      input.startsAt,
      input.endsAt,
    ),
  }
}

export async function decideTimeOff(input: {
  salonId: string
  timeOffId: string
  approve: boolean
  decidedByUserId?: string | null
}): Promise<{ status: string; clashes: number }> {
  const row = await unsafeDb.timeOff.findFirst({
    where: { id: input.timeOffId, salonId: input.salonId },
    select: { id: true, stylistProfileId: true, startsAt: true, endsAt: true, status: true },
  })
  if (!row) throw new DomainError('NOT_FOUND', 'That request is not here.')

  const status = input.approve ? 'APPROVED' : 'DENIED'

  await unsafeDb.timeOff.updateMany({
    where: { id: row.id, salonId: input.salonId },
    data: { status, approvedByUserId: input.decidedByUserId ?? null },
  })

  /*
   * The solver caches a stylist's availability, and approving holiday changes
   * it. Without this the diary would keep offering the days somebody has just
   * been given off until the cache aged out.
   */
  invalidateAvailabilityCache(input.salonId)

  return {
    status,
    clashes: input.approve
      ? await clashesFor(input.salonId, row.stylistProfileId, row.startsAt, row.endsAt)
      : 0,
  }
}

/** Withdraw a request, or give back time already approved. */
export async function cancelTimeOff(input: {
  salonId: string
  timeOffId: string
}): Promise<void> {
  const deleted = await unsafeDb.timeOff.deleteMany({
    where: { id: input.timeOffId, salonId: input.salonId },
  })
  if (deleted.count === 0) throw new DomainError('NOT_FOUND', 'That request is not here.')
  invalidateAvailabilityCache(input.salonId)
}
