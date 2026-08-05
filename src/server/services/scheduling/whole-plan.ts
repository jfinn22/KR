import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import { solveMultiSession } from '@/domain/scheduling/multi-session'
import { chainDuration } from '@/domain/scheduling/chain'
import { fromEpochMinutes } from '@/domain/scheduling/zoned'
import { windowFrom } from '@/domain/scheduling/window'
import { requiredSkillFor } from '../catalog'
import { loadPlan, sessionBookability } from '../service-plan'
import { loadAvailabilityRequest } from './loader'
import { bookFromHold, createHold, releaseHold } from './booking'
import { sessionChain } from './slots'

/**
 * Booking every visit of a plan at once.
 *
 * A correction plan is only honest if the client can actually get all three
 * appointments. Offering session one and hoping session two exists in eight
 * weeks is how a salon ends up with a half-finished blonde and an angry
 * client — and the whole reason the engine computes `minDaysAfterPrevious` and
 * `maxDaysAfterPrevious` is that the gap between visits is a chemical
 * constraint, not a preference.
 *
 * `solveMultiSession` has been in the domain layer since it was written, with
 * a backtracking search, a per-session branch cap and a real explanation of
 * which session failed. It had no callers. This is the caller.
 *
 * Why backtracking rather than "take the earliest each time": taking the very
 * first slot for session one can push session two past its maximum gap, when
 * starting a day later would have made the whole sequence work. Greedy gets
 * that wrong and reports the plan impossible.
 */

/** How far past each session's earliest date to look. */
const SEARCH_WINDOW_DAYS = 45

export interface WholePlanOffer {
  complete: boolean
  /** One per session, in order. Empty when no complete sequence exists. */
  sessions: {
    sequence: number
    name: string
    startsAt: string
    endsAt: string
    stylistId: string
    stylistName: string
    localDate: string
    durationMin: number
  }[]
  failedAtSequence: number | null
  reason: string | null
}

async function solveWholePlan(input: {
  salonId: string
  servicePlanId: string
  fromDate: string
  sameStylist?: boolean
  now?: Date
}) {
  const plan = await loadPlan(input.salonId, input.servicePlanId)

  const unbooked = plan.sessions
    .filter((session) => !session.appointment)
    .sort((a, b) => a.sequence - b.sequence)

  const locationId = await defaultLocationId(input.salonId)
  if (unbooked.length === 0) {
    return {
      plan,
      unbooked,
      locationId,
      result: { booking: [], complete: true, failedAtSequence: null, reason: null },
    }
  }

  const serviceIds = [...new Set(unbooked.flatMap((s) => s.services.map((x) => x.serviceId)))]

  /*
   * The gap after a session that is ALREADY DONE.
   *
   * `solveMultiSession` chains the gaps between the sessions it is given, and
   * knows nothing about the ones before them. Booking "the rest of the plan"
   * after visit one has happened would otherwise offer visit two tomorrow,
   * ignoring the eight weeks the engine said the hair needs — the exact
   * mistake the multi-session solver exists to prevent, reached from the one
   * direction it cannot see.
   */
  const gate = await sessionBookability(input.salonId, input.servicePlanId, unbooked[0]!.sequence)
  const searchFrom =
    gate.earliestDate && gate.earliestDate > input.fromDate ? gate.earliestDate : input.fromDate

  /*
   * The base request is loaded ONCE and reused for every session, which is why
   * `solveMultiSession` takes it without the chain or the dates. Loading it
   * per session would be five identical round trips, and — worse — five
   * snapshots of a diary that may have changed between them, so the solver
   * could produce a sequence no single moment in time ever supported.
   */
  const base = await loadAvailabilityRequest({
    salonId: input.salonId,
    locationId,
    fromDate: searchFrom,
    // Wide enough to contain every session the solver might reach for.
    toDate: addDaysLocal(searchFrom, SEARCH_WINDOW_DAYS * unbooked.length + 30),
    chain: sessionChain(unbooked[0]!),
    requiredSkill: await requiredSkillFor(input.salonId, serviceIds),
    isChemical: await anyChemical(input.salonId, serviceIds),
    isNewClient: false,
    window: windowFrom(plan),
    now: input.now,
  })

  const result = solveMultiSession({
    base,
    sessions: unbooked.map((session) => ({
      sequence: session.sequence,
      label: session.name,
      chain: sessionChain(session),
      minDaysAfterPrevious: session.minDaysAfterPrevious,
      maxDaysAfterPrevious: session.maxDaysAfterPrevious,
      requiresSameStylist: input.sameStylist ?? true,
    })),
    searchFromDate: searchFrom,
    searchWindowDays: SEARCH_WINDOW_DAYS,
    pinnedStylistId: plan.stylistProfileId,
    window: windowFrom(plan),
  })

  return { plan, unbooked, locationId, result }
}

export async function offerWholePlan(input: {
  salonId: string
  servicePlanId: string
  fromDate: string
  /** Every session with the same stylist, which most correction work wants. */
  sameStylist?: boolean
  now?: Date
}): Promise<WholePlanOffer> {
  const { unbooked, result } = await solveWholePlan(input)
  const names = await stylistNames(result.booking.map((s) => s.stylistId))

  return {
    complete: result.complete,
    sessions: result.booking.map((slot, index) => {
      const session = unbooked[index]!
      return {
        sequence: session.sequence,
        name: session.name,
        startsAt: fromEpochMinutes(slot.startMin).toISOString(),
        endsAt: fromEpochMinutes(slot.endMin).toISOString(),
        stylistId: slot.stylistId,
        stylistName: names.get(slot.stylistId) ?? 'Your stylist',
        localDate: slot.localDate,
        durationMin: chainDuration(sessionChain(session)),
      }
    }),
    failedAtSequence: result.failedAtSequence,
    reason: result.reason,
  }
}

/**
 * Take the whole sequence.
 *
 * Holds every session BEFORE booking any of them, and releases the lot if any
 * hold fails. Booking them one at a time would let a client end up with visits
 * one and two and a refusal on three — which is the exact half-finished state
 * the multi-session solver exists to prevent, arrived at by a different route.
 */
export async function bookWholePlan(input: {
  salonId: string
  servicePlanId: string
  fromDate: string
  sameStylist?: boolean
  createdByUserId?: string | null
  timeZone: string
  now?: Date
}): Promise<{ appointmentIds: string[] }> {
  const { plan, unbooked, locationId, result } = await solveWholePlan(input)

  if (!result.complete || result.booking.length === 0) {
    throw new DomainError(
      'CONFLICT',
      result.reason ?? 'The whole plan cannot be fitted in yet. Book the first visit on its own.',
    )
  }

  /*
   * The solver's own slots, placements and all — not a reconstruction from the
   * ISO strings the offer hands to a browser. Re-deriving the phase layout by
   * laying the chain end to end would quietly disagree with the solver the
   * first time a resource or an interleave changed the shape.
   */
  const holds: string[] = []
  try {
    for (const [index, slot] of result.booking.entries()) {
      const session = unbooked[index]!
      const { holdId } = await createHold({
        salonId: input.salonId,
        locationId,
        clientProfileId: plan.clientProfileId,
        slot,
        chain: sessionChain(session),
        servicePlanId: plan.id,
        servicePlanSessionId: session.id,
        // Long enough to write the rest of the sequence, short enough that a
        // crash halfway through returns the time within minutes.
        ttlSeconds: 300,
        createdByUserId: input.createdByUserId ?? null,
      })
      holds.push(holdId)
    }
  } catch (error) {
    // All or nothing. Holding sessions one and two and failing on three would
    // block times for a plan nobody ended up booking.
    await releaseAll(input.salonId, holds)
    throw error
  }

  const appointmentIds: string[] = []
  try {
    for (const [index, holdId] of holds.entries()) {
      const session = unbooked[index]!
      const booking = await bookFromHold({
        salonId: input.salonId,
        holdId,
        clientProfileId: plan.clientProfileId,
        services: session.services.map((s) => ({
          serviceId: s.serviceId,
          serviceVariantId: s.serviceVariantId,
          plannedDurationMin: s.plannedDurationMin,
          priceCents: s.plannedPriceCents,
        })),
        consultationId: plan.consultationId,
        source: 'CLIENT_PORTAL',
        createdByUserId: input.createdByUserId ?? null,
        timeZone: input.timeZone,
      })
      appointmentIds.push(booking.appointmentId)
    }
  } finally {
    // Anything not consumed by a booking goes straight back rather than
    // waiting out its TTL.
    await releaseAll(input.salonId, holds.slice(appointmentIds.length))
  }

  return { appointmentIds }
}

async function releaseAll(salonId: string, holdIds: readonly string[]): Promise<void> {
  for (const holdId of holdIds) {
    try {
      await releaseHold(salonId, holdId)
    } catch {
      // Already consumed or already gone. Either way there is nothing to free.
    }
  }
}

function addDaysLocal(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

async function anyChemical(salonId: string, serviceIds: readonly string[]): Promise<boolean> {
  const count = await unsafeDb.service.count({
    where: { salonId, id: { in: [...serviceIds] }, isChemical: true },
  })
  return count > 0
}

async function stylistNames(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await unsafeDb.stylistProfile.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, displayName: true },
  })
  return new Map(rows.map((r) => [r.id, r.displayName]))
}

async function defaultLocationId(salonId: string): Promise<string> {
  const location = await unsafeDb.location.findFirst({
    where: { salonId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!location) throw new DomainError('CONFLICT', 'This salon has no active location.')
  return location.id
}
