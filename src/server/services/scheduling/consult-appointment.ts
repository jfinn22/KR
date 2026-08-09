import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import type { PhaseChain } from '@/domain/scheduling/types'
import { bookFromHold, createHold } from './booking'
import { decodeSlot, findSlotsForChain, type SlotSearchResult } from './slots'
import { computeAvailability } from '@/domain/scheduling/availability'
import { loadAvailabilityRequest } from './loader'

/**
 * "Come in and let me look at it."
 *
 * `REQUEST_IN_PERSON` has been one of six review decisions since the schema
 * was written. It set the consultation's status to `NEEDS_IN_PERSON` and
 * stopped — no appointment, no invitation, nothing the client could act on.
 * The stylist's judgement that they needed to see the hair in person went
 * into a status column and died there.
 *
 * What it needed was not much: thirty minutes with the stylist who asked. The
 * client picks the time, as they do for everything else — a stylist choosing
 * a slot for somebody whose availability they do not know is how you get a
 * no-show that everyone blames on the client.
 *
 * There is deliberately no catalog service behind this. A salon should not
 * have to invent a £0 "consultation" product to use a feature the review
 * screen already offers, and inventing one on their behalf would put a row in
 * their price list they never asked for.
 */

/** Long enough to look properly, short enough to fit in a gap. */
export const CONSULT_MINUTES = 30

function consultChain(minutes = CONSULT_MINUTES): PhaseChain {
  return [
    {
      // `ACTIVE`, not a kind of its own. A consultation is the stylist giving
      // somebody their full attention, which is exactly what ACTIVE means to
      // the solver — and inventing a sixth phase kind for it would ripple
      // through every switch that handles them.
      kind: 'ACTIVE',
      label: 'In-person consultation',
      durationMin: minutes,
      // The stylist is the entire point of this appointment.
      blocksStylist: true,
      blocksResource: false,
      requiresResourceType: null,
      serviceId: null,
    },
  ]
}

async function loadInvite(salonId: string, consultationId: string) {
  const db = dbFor(salonId)
  const consultation = await db.consultation.findFirst({
    where: { id: consultationId, salonId },
    select: {
      id: true,
      status: true,
      clientProfileId: true,
      requestedStylistId: true,
    },
  })
  if (!consultation) throw new DomainError('NOT_FOUND', 'That consultation no longer exists.')
  if (consultation.status !== 'NEEDS_IN_PERSON') {
    throw new DomainError('CONFLICT', 'Nobody has asked to see this one in person.')
  }
  return consultation
}

/** Whether there is an invitation to show, and what it says. */
export async function consultInvite(salonId: string, consultationId: string) {
  const db = dbFor(salonId)
  const consultation = await db.consultation.findFirst({
    where: { id: consultationId, salonId, status: 'NEEDS_IN_PERSON' },
    select: { id: true, requestedStylistId: true },
  })
  if (!consultation) return null

  const [stylist, review, booked] = await Promise.all([
    consultation.requestedStylistId
      ? db.stylistProfile.findUnique({
          where: { id: consultation.requestedStylistId },
          select: { displayName: true },
        })
      : Promise.resolve(null),
    db.consultationReview.findFirst({
      where: { consultationId: consultation.id, salonId },
      orderBy: { decidedAt: 'desc' },
      select: { notesToClient: true },
    }),
    db.appointment.findFirst({
      where: {
        salonId,
        consultationId: consultation.id,
        status: { in: ['BOOKED', 'CONFIRMED'] },
      },
      orderBy: { startsAt: 'asc' },
      select: { id: true, startsAt: true },
    }),
  ])

  return {
    consultationId: consultation.id,
    stylistId: consultation.requestedStylistId,
    stylistName: stylist?.displayName ?? null,
    /*
     * The stylist's own words. `notesToClient` is the field the decision panel
     * has always collected and — until Phase 2 — nothing ever selected. A
     * client asked to come in with no reason given reads it as bad news.
     */
    reason: review?.notesToClient ?? null,
    minutes: CONSULT_MINUTES,
    alreadyBooked: booked,
  }
}

export async function findConsultSlots(input: {
  salonId: string
  consultationId: string
  fromDate: string
  toDate: string
  now?: Date
}): Promise<SlotSearchResult> {
  const consultation = await loadInvite(input.salonId, input.consultationId)

  return findSlotsForChain({
    salonId: input.salonId,
    fromDate: input.fromDate,
    toDate: input.toDate,
    chain: consultChain(),
    // Pinned to whoever asked to see them. Being sent to a different stylist
    // than the one who wanted a look defeats the purpose of the request.
    stylistId: consultation.requestedStylistId,
    now: input.now,
  })
}

export async function bookConsultAppointment(input: {
  salonId: string
  consultationId: string
  token: string
  createdByUserId?: string | null
  timeZone: string
  now?: Date
}): Promise<{ appointmentId: string; startsAt: Date; endsAt: Date }> {
  const db = dbFor(input.salonId)
  const consultation = await loadInvite(input.salonId, input.consultationId)

  const existing = await db.appointment.findFirst({
    where: {
      salonId: input.salonId,
      consultationId: consultation.id,
      status: { in: ['BOOKED', 'CONFIRMED'] },
    },
    select: { id: true, startsAt: true, endsAt: true },
  })
  if (existing) {
    return {
      appointmentId: existing.id,
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
    }
  }

  const decoded = decodeSlot(input.token)
  if (!decoded) throw new DomainError('INVALID_INPUT', 'That time is no longer valid.')

  const chain = consultChain()
  const locationId = await defaultLocationId(input.salonId)

  /*
   * Re-solved rather than reconstructed from the token, same as every other
   * confirm in this codebase: between the search and the tap somebody else may
   * have taken the chair.
   */
  const request = await loadAvailabilityRequest({
    salonId: input.salonId,
    locationId,
    fromDate: decoded.localDate,
    toDate: decoded.localDate,
    chain,
    requiredSkill: null,
    isChemical: false,
    isNewClient: false,
    pinnedStylistId: decoded.stylistId,
    now: input.now,
  })
  const slot = computeAvailability(request).slots.find(
    (s) => s.startMin === decoded.startMin && s.stylistId === decoded.stylistId,
  )
  if (!slot) throw new DomainError('CONFLICT', 'That time was just taken. Pick another.')

  const { holdId } = await createHold({
    salonId: input.salonId,
    locationId,
    clientProfileId: consultation.clientProfileId,
    slot,
    chain,
    ttlSeconds: 120,
    createdByUserId: input.createdByUserId ?? null,
  })

  const booking = await bookFromHold({
    salonId: input.salonId,
    holdId,
    clientProfileId: consultation.clientProfileId,
    // No services: this is a conversation, not work. An appointment with no
    // service lines is exactly what it is, and inventing a £0 one to fill the
    // gap would put a phantom product on the bill.
    services: [],
    consultationId: consultation.id,
    source: 'FRONT_DESK',
    createdByUserId: input.createdByUserId ?? null,
    timeZone: input.timeZone,
  })

  return {
    appointmentId: booking.appointmentId,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
  }
}

async function defaultLocationId(salonId: string): Promise<string> {
  const db = dbFor(salonId)
  const location = await db.location.findFirst({
    where: { salonId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!location) throw new DomainError('CONFLICT', 'This salon has no active location.')
  return location.id
}
