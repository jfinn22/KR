import { Prisma } from '@prisma/client'
import { unsafeDb } from '@/server/db/client'
import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import { EVERY_DAY, describeWindow, windowFrom } from '@/domain/scheduling/window'
import { chainDuration } from '@/domain/scheduling/chain'
import { localDateOfEpochMinutes, toEpochMinutes } from '@/domain/scheduling/zoned'
import { chainForServices, findSlotsForServices, resolveSlotForServices } from './slots'
import { assertGate, serviceLinesFor } from './staff-booking'
import { bookFromHold, createHold, releaseHold } from './booking'

/**
 * The waitlist.
 *
 * `WaitlistEntry` has been in the schema since it was written with five fields
 * nothing read: `dayOfWeekMask`, the two window minutes, `preferredStylistIds`
 * and `serviceIds`. A client could say "Tuesday or Thursday, mornings, with
 * Wren, for a balayage" and be offered a Friday evening with somebody else for
 * something that does not fit. There was also no way to get onto the list at
 * all — no creation path, from either side.
 *
 * Two decisions worth stating, because both could reasonably go the other way.
 *
 * AN OFFER TAKES A REAL HOLD. An offer without one is a promise the salon
 * cannot keep: the client drops what they are doing, taps accept, and finds
 * the slot gone — which is worse than never having been offered it. A hold
 * does block the slot for everyone else, and that is the cost. It is bounded
 * by making the hold short and by offering to one person at a time.
 *
 * THE OFFER IS SOLVED, NOT ASSUMED. The old matcher compared the freed
 * appointment's duration against `requiredDurationMin` and offered its exact
 * start time. That is not the same question: a two-hour cancellation does not
 * mean a two-hour service fits there, because the stylist may be needed
 * elsewhere in it, and a client's chain has buffers the raw duration does not.
 * It now runs the real solver through R7, so an offer is a slot that genuinely
 * exists.
 */

/** How long somebody gets to answer, at the outside. */
const OFFER_WINDOW_MS = 2 * 3_600_000

/** Never hold a slot right up to its own start — that is a slot nobody gets. */
const MIN_LEAD_BEFORE_START_MS = 60 * 60_000

export interface JoinWaitlistInput {
  salonId: string
  clientProfileId: string
  serviceIds: readonly string[]
  earliestDate: string
  latestDate: string
  dayOfWeekMask?: number
  windowStartMinute?: number
  windowEndMinute?: number
  preferredStylistIds?: readonly string[]
  /** Higher goes first. Reserved for the desk; a client cannot set their own. */
  priority?: number
}

export async function joinWaitlist(input: JoinWaitlistInput): Promise<{ id: string }> {
  const db = dbFor(input.salonId)
  if (input.latestDate < input.earliestDate) {
    throw new DomainError('INVALID_INPUT', 'That date range runs backwards.')
  }
  const mask = input.dayOfWeekMask ?? EVERY_DAY
  if ((mask & EVERY_DAY) === 0) {
    throw new DomainError('INVALID_INPUT', 'Pick at least one day of the week.')
  }

  /*
   * The duration comes from the real chain rather than from the caller. A
   * client cannot be trusted to know that their balayage takes three hours
   * with buffers, and a wrong number here is an offer that does not fit.
   */
  const chain = await chainForServices(input.salonId, input.serviceIds)

  const entry = await db.waitlistEntry.create({
    data: {
      salonId: input.salonId,
      clientProfileId: input.clientProfileId,
      serviceIds: [...input.serviceIds],
      preferredStylistIds: [...(input.preferredStylistIds ?? [])],
      anyStylist: (input.preferredStylistIds ?? []).length === 0,
      requiredDurationMin: chainDuration(chain),
      earliestDate: new Date(`${input.earliestDate}T00:00:00Z`),
      latestDate: new Date(`${input.latestDate}T00:00:00Z`),
      dayOfWeekMask: mask,
      windowStartMinute: input.windowStartMinute ?? 0,
      windowEndMinute: input.windowEndMinute ?? 1440,
      priority: input.priority ?? 0,
      status: 'OPEN',
    },
    select: { id: true },
  })

  return { id: entry.id }
}

export async function leaveWaitlist(input: {
  salonId: string
  entryId: string
}): Promise<{ left: boolean }> {
  const db = dbFor(input.salonId)
  const entry = await db.waitlistEntry.findFirst({
    where: { id: input.entryId, salonId: input.salonId },
    select: { id: true, status: true, offeredHoldId: true },
  })
  if (!entry) throw new DomainError('NOT_FOUND', 'That waitlist entry no longer exists.')

  // Give the held slot back on the way out, or it sits blocked until it
  // expires for somebody who is no longer waiting for it.
  if (entry.offeredHoldId) await releaseOfferedHold(input.salonId, entry.offeredHoldId)

  await db.waitlistEntry.update({
    where: { id: entry.id },
    data: { status: 'CANCELLED', offeredHoldId: null, offeredSlotJson: Prisma.DbNull },
  })
  return { left: true }
}

/**
 * A slot has come free. Find whoever it actually suits.
 *
 * Walks the list in priority order and stops at the first entry the solver can
 * genuinely place — one offer at a time, because offering the same slot to
 * five people means four of them are being lied to.
 */
export async function matchWaitlist(input: {
  salonId: string
  localDate: string
  freedStartMin: number
  freedEndMin: number
  now?: Date
}): Promise<{ offeredTo: string | null }> {
  const db = dbFor(input.salonId)
  const now = input.now ?? new Date()
  const date = new Date(`${input.localDate}T00:00:00Z`)

  const entries = await db.waitlistEntry.findMany({
    where: {
      salonId: input.salonId,
      status: 'OPEN',
      earliestDate: { lte: date },
      latestDate: { gte: date },
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    /*
     * Bounded so one cancellation cannot run the solver over a thousand
     * entries. Twenty-five is far past where a match realistically comes from
     * — but if every one of them is ruled out, somebody at position 26 is
     * being skipped, and that gets said out loud rather than silently dropped.
     */
    take: 25,
  })

  for (const entry of entries) {
    if (entry.serviceIds.length === 0) continue

    /*
     * The client's own window, ANDed with the day that just came free. Both
     * matter: their standing "Tuesdays, mornings" and the fact that the free
     * time is on this particular date.
     */
    const window = {
      ...windowFrom(entry),
      earliestDate: input.localDate,
      latestDate: input.localDate,
    }

    let result
    try {
      result = await findSlotsForServices({
        salonId: input.salonId,
        serviceIds: entry.serviceIds,
        fromDate: input.localDate,
        toDate: input.localDate,
        stylistIds: entry.anyStylist ? undefined : entry.preferredStylistIds,
        window,
        now,
      })
    } catch {
      // A service that has since been deleted, most likely. Not a reason to
      // stop matching everybody behind them.
      continue
    }

    /*
     * Only a slot that actually uses the time that came free — the solver
     * would happily return an unrelated gap later that day, and offering that
     * as "somebody cancelled" is a different and much less urgent thing — and
     * only one far enough ahead that the client could still get here.
     *
     * Every candidate is tried, not just the first. Taking the earliest
     * overlapping slot and giving up when it turns out to start in forty
     * minutes would skip the client entirely over a slot they never wanted,
     * while a perfectly good one sat an hour later in the same list.
     */
    const candidate = result.slots
      .map((s) => ({
        slot: s,
        start: toEpochMinutes(new Date(s.startsAt)),
        end: toEpochMinutes(new Date(s.endsAt)),
      }))
      .filter((s) => s.start < input.freedEndMin && s.end > input.freedStartMin)
      .map((s) => ({
        ...s,
        expiresAt: new Date(
          Math.min(
            now.getTime() + OFFER_WINDOW_MS,
            new Date(s.slot.startsAt).getTime() - MIN_LEAD_BEFORE_START_MS,
          ),
        ),
      }))
      .find((s) => s.expiresAt > now)

    if (!candidate) continue
    const { slot, expiresAt } = candidate

    /*
     * Take the slot off the board for exactly as long as the offer stands.
     * This is what makes the offer a real one — and it is the same mechanism
     * the client portal already uses, so the exclusion constraint is doing the
     * enforcing rather than a check somebody could race past.
     */
    const resolved = await resolveSlotForServices({
      salonId: input.salonId,
      serviceIds: entry.serviceIds,
      stylistIds: entry.anyStylist ? undefined : entry.preferredStylistIds,
      window,
      token: slot.token,
      now,
    })
    if (!resolved) continue

    let holdId: string
    try {
      const hold = await createHold({
        salonId: input.salonId,
        locationId: resolved.locationId,
        clientProfileId: entry.clientProfileId,
        slot: resolved.slot,
        chain: resolved.chain,
        ttlSeconds: Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
        reason: 'Waitlist offer',
      })
      holdId = hold.holdId
    } catch {
      // Somebody took it in the moment between solving and holding. The next
      // cancellation will find this entry again.
      continue
    }

    await db.waitlistEntry.update({
      where: { id: entry.id },
      data: {
        status: 'OFFERED',
        offeredSlotJson: {
          token: slot.token,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          stylistId: slot.stylistId,
          stylistName: slot.stylistName,
          localDate: slot.localDate,
        } as never,
        offeredHoldId: holdId,
        offerExpiresAt: expiresAt,
        notifiedAt: now,
      },
    })

    await db.outbox.create({
      data: {
        salonId: input.salonId,
        topic: 'waitlist.offered',
        payloadJson: {
          waitlistEntryId: entry.id,
          clientProfileId: entry.clientProfileId,
          startsAt: slot.startsAt,
          expiresAt: expiresAt.toISOString(),
        },
      },
    })

    return { offeredTo: entry.id }
  }

  if (entries.length === 25) {
    await db.outbox.create({
      data: {
        salonId: input.salonId,
        topic: 'waitlist.match_exhausted',
        payloadJson: {
          localDate: input.localDate,
          considered: entries.length,
          note: 'Nobody in the first 25 entries fitted. Anybody behind them was not looked at.',
        },
      },
    })
  }

  return { offeredTo: null }
}

/** Take the offer. */
export async function acceptOffer(input: {
  salonId: string
  entryId: string
  timeZone: string
  actorUserId?: string | null
}): Promise<{ appointmentId: string }> {
  const db = dbFor(input.salonId)
  const entry = await db.waitlistEntry.findFirst({
    where: { id: input.entryId, salonId: input.salonId },
  })
  if (!entry) throw new DomainError('NOT_FOUND', 'That waitlist entry no longer exists.')
  if (entry.status !== 'OFFERED') {
    throw new DomainError('CONFLICT', 'There is no offer open on that entry.')
  }
  if (entry.offerExpiresAt && entry.offerExpiresAt < new Date()) {
    throw new DomainError('CONFLICT', 'That offer has expired. You are still on the list.')
  }

  if (!entry.offeredHoldId) {
    throw new DomainError('CONFLICT', 'That offer is no longer valid.')
  }

  /*
   * The gate still applies. A waitlist is not a way around needing a patch
   * test, and a client who joined the list for a colour six weeks ago may
   * have let theirs expire since. `mayOverride` is false because a client
   * accepting an offer is not signing anything off — if the basket needs a
   * consultation, this refuses, which is the correct answer.
   */
  await assertGate({
    salonId: input.salonId,
    clientProfileId: entry.clientProfileId,
    serviceIds: entry.serviceIds,
    mayOverride: false,
  })

  /*
   * Booked from the hold that has been standing behind the offer, rather than
   * searching again. `bookFromHold` PROMOTES the held segments instead of
   * deleting and re-inserting them, so there is never an instant where the
   * slot the client was promised is free for somebody else to take.
   */
  const chain = await chainForServices(input.salonId, entry.serviceIds)
  const services = await serviceLinesFor(input.salonId, entry.serviceIds, chain)

  const booking = await bookFromHold({
    salonId: input.salonId,
    holdId: entry.offeredHoldId,
    clientProfileId: entry.clientProfileId,
    services,
    source: 'WAITLIST',
    clientNote: 'Booked from the waitlist.',
    createdByUserId: input.actorUserId ?? null,
    timeZone: input.timeZone,
  })

  await db.waitlistEntry.update({
    where: { id: entry.id },
    data: { status: 'BOOKED', offeredHoldId: null },
  })

  return { appointmentId: booking.appointmentId }
}

/** Turn it down. Back on the list, not off it. */
export async function declineOffer(input: {
  salonId: string
  entryId: string
}): Promise<{ declined: boolean }> {
  const db = dbFor(input.salonId)
  const entry = await db.waitlistEntry.findFirst({
    where: { id: input.entryId, salonId: input.salonId },
    select: { id: true, status: true, offeredHoldId: true },
  })
  if (!entry) throw new DomainError('NOT_FOUND', 'That waitlist entry no longer exists.')
  if (entry.status !== 'OFFERED') return { declined: true }

  if (entry.offeredHoldId) await releaseOfferedHold(input.salonId, entry.offeredHoldId)

  await db.waitlistEntry.update({
    where: { id: entry.id },
    data: {
      // Cleared, not left behind. `undefined` means "do not touch" to Prisma,
      // which would leave a stale offer sitting on a row that is open again.
      status: 'OPEN',
      offeredSlotJson: Prisma.DbNull,
      offerExpiresAt: null,
      offeredHoldId: null,
    },
  })
  return { declined: true }
}

/**
 * Reopen offers nobody answered.
 *
 * Without this an unanswered offer sits `OFFERED` forever: the client never
 * gets another one, and the entry never comes back into the pool for the next
 * cancellation. A waitlist that quietly stops matching is worse than not
 * having one, because the salon believes it is working.
 */
export async function sweepExpiredOffers(now = new Date()): Promise<{ reopened: number }> {
  const stale = await unsafeDb.waitlistEntry.findMany({
    where: { status: 'OFFERED', offerExpiresAt: { lt: now } },
    select: { id: true, salonId: true, offeredHoldId: true },
    take: 200,
  })

  for (const entry of stale) {
    if (entry.offeredHoldId) await releaseOfferedHold(entry.salonId, entry.offeredHoldId)
    await dbFor(entry.salonId).waitlistEntry.updateMany({
      where: { id: entry.id },
      data: {
        status: 'OPEN',
        offeredSlotJson: Prisma.DbNull,
        offerExpiresAt: null,
        offeredHoldId: null,
      },
    })
  }

  return { reopened: stale.length }
}

/** What this client is waiting for, and whether anything is on the table. */
export async function waitlistFor(salonId: string, clientProfileId: string) {
  const db = dbFor(salonId)
  const entries = await db.waitlistEntry.findMany({
    where: { salonId, clientProfileId, status: { in: ['OPEN', 'OFFERED'] } },
    orderBy: { createdAt: 'desc' },
  })

  const serviceIds = [...new Set(entries.flatMap((e) => e.serviceIds))]
  const services = await db.service.findMany({
    where: { salonId, id: { in: serviceIds } },
    select: { id: true, name: true },
  })
  const names = new Map(services.map((s) => [s.id, s.name]))

  return entries.map((entry) => ({
    id: entry.id,
    status: entry.status,
    serviceNames: entry.serviceIds.map((id) => names.get(id) ?? 'A service'),
    /** The standing preference in words, so the client can check it is right. */
    describes: describeWindow(windowFrom(entry)),
    offer:
      entry.status === 'OFFERED'
        ? (entry.offeredSlotJson as {
            startsAt: string
            endsAt: string
            stylistName: string
          } | null)
        : null,
    offerExpiresAt: entry.offerExpiresAt,
  }))
}

/** The salon's own view: who is waiting, longest first. */
export async function salonWaitlist(salonId: string) {
  const db = dbFor(salonId)
  const entries = await db.waitlistEntry.findMany({
    where: { salonId, status: { in: ['OPEN', 'OFFERED'] } },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    take: 100,
    include: { clientProfile: { select: { id: true, firstName: true, lastName: true } } },
  })

  const serviceIds = [...new Set(entries.flatMap((e) => e.serviceIds))]
  const services = await db.service.findMany({
    where: { salonId, id: { in: serviceIds } },
    select: { id: true, name: true },
  })
  const names = new Map(services.map((s) => [s.id, s.name]))

  return entries.map((entry) => ({
    id: entry.id,
    status: entry.status,
    clientId: entry.clientProfile.id,
    clientName: `${entry.clientProfile.firstName} ${entry.clientProfile.lastName ?? ''}`.trim(),
    serviceNames: entry.serviceIds.map((id) => names.get(id) ?? 'A service'),
    describes: describeWindow(windowFrom(entry)),
    requiredDurationMin: entry.requiredDurationMin,
    waitingSince: entry.createdAt,
    offerExpiresAt: entry.offerExpiresAt,
  }))
}

async function releaseOfferedHold(salonId: string, holdId: string): Promise<void> {
  try {
    await releaseHold(salonId, holdId)
  } catch {
    // Already gone, which is the state we wanted.
  }
}

/** The local date and epoch-minute span a cancelled appointment freed up. */
export function freedWindow(
  appointment: { startsAt: Date; endsAt: Date },
  timeZone: string,
): { localDate: string; freedStartMin: number; freedEndMin: number } {
  const freedStartMin = toEpochMinutes(appointment.startsAt)
  return {
    localDate: localDateOfEpochMinutes(freedStartMin, timeZone),
    freedStartMin,
    freedEndMin: toEpochMinutes(appointment.endsAt),
  }
}
