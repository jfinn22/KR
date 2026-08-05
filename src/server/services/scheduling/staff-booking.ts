import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import { bookingGate, type GateDecision } from '@/domain/scheduling/gate'
import { getServices } from '../catalog'
import { validPatchTest } from '../compliance'
import { bookFromHold, createHold } from './booking'
import { chainForServices, resolveSlotForServices } from './slots'
import type { BookingWindow } from '@/domain/scheduling/window'

/**
 * Booking from behind the desk.
 *
 * The client portal never needed this: every route into it starts with a
 * consultation, so an approved plan is a precondition of reaching the slot
 * picker. Somebody ringing up for a trim on Thursday has no such funnel, and
 * until now there was no way to put them in the diary at all — the schema, the
 * solver and `bookDirect` were all ready and there was no door.
 *
 * What the desk gets that the client portal does not: the ability to book
 * without a plan, gated by `bookingGate` and, where the gate says so, by a
 * named person giving a reason. What it does not get: a way past a patch test.
 */

export interface DeskBookingContext {
  gate: GateDecision
  /** Minutes the whole thing will take, so the desk can see it before searching. */
  durationMin: number
  /** What it will cost, at today's prices. Not frozen — nobody has agreed to it. */
  estimatedTotalCents: number
  services: { id: string; name: string; priceCents: number }[]
}

/**
 * What the desk needs to know before it searches.
 *
 * Deliberately answered before any slot is shown. A desk that searches, picks
 * a time, and only then learns the client needs a patch test has wasted the
 * call — and worse, has said "Thursday at two?" out loud to somebody who
 * cannot have it.
 */
export async function deskBookingContext(input: {
  salonId: string
  clientProfileId: string
  serviceIds: readonly string[]
  /** An approved plan the desk is booking against, if there is one. */
  servicePlanId?: string | null
}): Promise<DeskBookingContext> {
  const services = await getServices(input.salonId, input.serviceIds)

  const [patchTest, plan, chain] = await Promise.all([
    validPatchTest(input.salonId, input.clientProfileId),
    input.servicePlanId
      ? unsafeDb.servicePlan.findFirst({
          where: {
            id: input.servicePlanId,
            salonId: input.salonId,
            clientProfileId: input.clientProfileId,
            status: 'APPROVED',
            validUntil: { gt: new Date() },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
    chainForServices(input.salonId, input.serviceIds),
  ])

  const gate = bookingGate({
    services: services.map((s) => ({
      name: s.name,
      requiresConsultation: s.requiresConsultation,
      isChemical: s.isChemical,
      isLightening: s.isLightening,
      requiresPatchTest: s.requiresPatchTest,
    })),
    hasApprovedPlan: plan !== null,
    hasValidPatchTest: patchTest !== null,
  })

  return {
    gate,
    durationMin: chain.reduce((sum, link) => sum + link.durationMin, 0),
    estimatedTotalCents: services.reduce((sum, s) => sum + s.basePriceCents, 0),
    services: services.map((s) => ({ id: s.id, name: s.name, priceCents: s.basePriceCents })),
  }
}

export interface DeskBookingInput {
  salonId: string
  clientProfileId: string
  serviceIds: readonly string[]
  token: string
  locationId?: string | null
  stylistId?: string | null
  window?: BookingWindow | null
  clientNote?: string | null
  createdByUserId?: string | null
  timeZone: string
  /**
   * Why this is being booked without a consultation.
   *
   * Required when the gate says `OVERRIDABLE`, and recorded on the
   * appointment rather than only in the audit log — the person doing the hair
   * on the day is the one who needs to know nobody assessed it, and they will
   * not be reading an audit log.
   */
  overrideReason?: string | null
  /** Whether the caller actually holds `appointment.bookWithoutConsultation`. */
  mayOverride?: boolean
  now?: Date
}

/**
 * Refuse anything the gate refuses, and demand a name where it demands one.
 *
 * Checked on the WRITE, not only on the screen that rendered the button. A
 * screen can be stale, a request can be replayed, and a form can be posted by
 * something that never rendered anything. Exported because the waitlist books
 * through its own held slot and must not become a way around this.
 */
export async function assertGate(input: {
  salonId: string
  clientProfileId: string
  serviceIds: readonly string[]
  mayOverride?: boolean
  overrideReason?: string | null
}): Promise<DeskBookingContext> {
  const context = await deskBookingContext(input)

  if (context.gate.decision === 'REFUSED') {
    throw new DomainError('CONFLICT', context.gate.reason)
  }

  if (context.gate.decision === 'OVERRIDABLE') {
    if (!input.mayOverride) {
      throw new DomainError(
        'FORBIDDEN',
        `${context.gate.reason} Ask a manager, or start a consultation.`,
      )
    }
    if (!input.overrideReason || input.overrideReason.trim().length < 4) {
      throw new DomainError(
        'INVALID_INPUT',
        'Say why this is going in the diary without a consultation.',
      )
    }
  }

  return context
}

/**
 * The service lines an appointment carries, with the chain's minutes split
 * across them.
 *
 * The chain is built from all the services at once and its buffers wrap the
 * whole appointment, so there is no per-service boundary to read back out.
 * Apportioning evenly is honest about that rather than inventing a precision
 * the chain does not carry — and `plannedDurationMin` is used for reporting,
 * never for placing the appointment, which the chain already did.
 */
export async function serviceLinesFor(
  salonId: string,
  serviceIds: readonly string[],
  chain: readonly { durationMin: number }[],
) {
  const services = await getServices(salonId, serviceIds)
  const parts = splitDuration(chain, services.length)
  return services.map((service, index) => ({
    serviceId: service.id,
    plannedDurationMin: parts[index] ?? 0,
    priceCents: service.basePriceCents,
  }))
}

export async function bookFromDesk(input: DeskBookingInput): Promise<{
  appointmentId: string
  startsAt: Date
  endsAt: Date
}> {
  const context = await assertGate(input)

  const resolved = await resolveSlotForServices({
    salonId: input.salonId,
    serviceIds: input.serviceIds,
    locationId: input.locationId,
    stylistId: input.stylistId,
    window: input.window ?? null,
    token: input.token,
    now: input.now,
  })
  if (!resolved) {
    throw new DomainError('CONFLICT', 'That time was just taken. Search again.')
  }

  const services = await serviceLinesFor(input.salonId, input.serviceIds, resolved.chain)

  const { holdId } = await createHold({
    salonId: input.salonId,
    locationId: resolved.locationId,
    clientProfileId: input.clientProfileId,
    slot: resolved.slot,
    chain: resolved.chain,
    ttlSeconds: 120,
    createdByUserId: input.createdByUserId ?? null,
    reason: input.overrideReason ?? null,
  })

  const booking = await bookFromHold({
    salonId: input.salonId,
    holdId,
    clientProfileId: input.clientProfileId,
    services,
    source: 'FRONT_DESK',
    clientNote: input.clientNote ?? null,
    createdByUserId: input.createdByUserId ?? null,
    timeZone: input.timeZone,
  })

  /*
   * The override lands on the appointment, where the stylist will see it.
   * `internalNote` is the field the day-of screens already read, so a colour
   * booked with nobody having looked at the hair says so on the card the
   * person holding the brush is looking at.
   */
  if (context.gate.decision === 'OVERRIDABLE' && input.overrideReason) {
    await unsafeDb.appointment.update({
      where: { id: booking.appointmentId },
      data: {
        internalNote: `Booked without a consultation. ${input.overrideReason.trim()}`,
      },
    })
  }

  return {
    appointmentId: booking.appointmentId,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
  }
}

function splitDuration(
  chain: readonly { durationMin: number }[],
  serviceCount: number,
): number[] {
  const total = chain.reduce((sum, link) => sum + link.durationMin, 0)
  if (serviceCount <= 0) return []
  const each = Math.floor(total / serviceCount)
  const parts = Array.from({ length: serviceCount }, () => each)
  // The remainder goes on the first service rather than being lost, so the
  // parts always add back up to the whole.
  parts[0] = (parts[0] ?? 0) + (total - each * serviceCount)
  return parts
}
