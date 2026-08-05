'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import { findSlots, findSlotsForServices, resolveSlot } from '@/server/services/scheduling/slots'
import { bookFromDesk, deskBookingContext } from '@/server/services/scheduling/staff-booking'
import { loadGap } from '@/server/services/scheduling/gap-fill'
import {
  bookConsultAppointment,
  findConsultSlots,
} from '@/server/services/scheduling/consult-appointment'
import {
  acceptOffer,
  declineOffer,
  joinWaitlist,
  leaveWaitlist,
} from '@/server/services/scheduling/waitlist'
import { bookWholePlan, offerWholePlan } from '@/server/services/scheduling/whole-plan'
import { can } from '@/domain/authz/policy'
import {
  bookFromHold,
  cancelAppointment,
  createHold,
  releaseHold,
} from '@/server/services/scheduling/booking'
import { invalidateAvailabilityCache } from '@/server/services/scheduling/loader'
import { loadPlan } from '@/server/services/service-plan'
import { authorizeDeposit } from '@/server/services/deposits'
import { unsafeDb } from '@/server/db/client'
import type { TenantContext } from '@/server/auth/context'

/**
 * Booking server actions.
 *
 * The sequence is search → hold → confirm, and the hold is what makes it safe:
 * a client filling in the confirmation screen is not racing the person who
 * loaded the same slot list a second earlier. Holds expire on their own, so an
 * abandoned checkout returns the time to the salon without anyone intervening.
 */

const cuid = z.string().min(1).max(64)
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.')

/** How long a client gets to finish the confirmation screen. */
const HOLD_TTL_SECONDS = 10 * 60

async function planResource(servicePlanId: string, ctx: TenantContext) {
  const plan = await unsafeDb.servicePlan.findFirst({
    where: { id: servicePlanId, salonId: ctx.salonId },
    select: { clientProfileId: true, stylistProfileId: true },
  })
  if (!plan) throw new DomainError('NOT_FOUND', 'That plan no longer exists.')
  return {
    salonId: ctx.salonId,
    clientProfileId: plan.clientProfileId,
    ownerStylistId: plan.stylistProfileId,
  }
}

async function clientResource(clientProfileId: string, ctx: TenantContext) {
  const client = await unsafeDb.clientProfile.findFirst({
    where: { id: clientProfileId, salonId: ctx.salonId },
    select: { id: true, preferredStylistId: true },
  })
  if (!client) throw new DomainError('NOT_FOUND', 'That client is not on file.')
  return {
    salonId: ctx.salonId,
    clientProfileId: client.id,
    ownerStylistId: client.preferredStylistId,
  }
}

async function appointmentResource(appointmentId: string, ctx: TenantContext) {
  const appointment = await unsafeDb.appointment.findFirst({
    where: { id: appointmentId, salonId: ctx.salonId },
    select: { clientProfileId: true, primaryStylistId: true, locationId: true },
  })
  if (!appointment) throw new DomainError('NOT_FOUND', 'That appointment no longer exists.')
  return {
    salonId: ctx.salonId,
    clientProfileId: appointment.clientProfileId,
    ownerStylistId: appointment.primaryStylistId,
    locationId: appointment.locationId,
  }
}

const searchSchema = z.object({
  servicePlanId: cuid,
  sequence: z.number().int().min(1).max(12),
  fromDate: localDate,
  toDate: localDate,
  locationId: cuid.nullish(),
  stylistId: cuid.nullish(),
  anyStylist: z.boolean().optional(),
})

/** Read-only, so no audit row: searching for a time is not an event. */
export const findSlotsAction = withAuthz(
  {
    action: 'appointment.book',
    schema: searchSchema,
    resource: (input, ctx) => planResource(input.servicePlanId, ctx),
  },
  async (input, ctx) => {
    if (input.toDate < input.fromDate) {
      throw new DomainError('INVALID_INPUT', 'That date range runs backwards.')
    }
    return findSlots({ salonId: ctx.salonId, ...input })
  },
)

/**
 * Take the slot off the board while the client confirms.
 *
 * The slot is re-solved from the token rather than reconstructed: between the
 * search and the tap somebody else may have taken the chair, and the placements
 * written into the hold must be ones the solver just verified.
 */
export const holdSlotAction = withAuthz(
  {
    action: 'hold.create',
    schema: searchSchema.extend({ token: z.string().min(3).max(200) }),
    resource: (input, ctx) => planResource(input.servicePlanId, ctx),
  },
  async (input, ctx) => {
    const plan = await loadPlan(ctx.salonId, input.servicePlanId)
    const session = plan.sessions.find((s) => s.sequence === input.sequence)
    if (!session) throw new DomainError('NOT_FOUND', 'That session is not part of this plan.')

    const resolved = await resolveSlot({ salonId: ctx.salonId, ...input })
    if (!resolved) {
      throw new DomainError('CONFLICT', 'That time was just taken. Here are the times still free.')
    }

    const { holdId, expiresAt } = await createHold({
      salonId: ctx.salonId,
      locationId: resolved.locationId,
      clientProfileId: plan.clientProfileId,
      slot: resolved.slot,
      chain: resolved.chain,
      servicePlanId: plan.id,
      servicePlanSessionId: session.id,
      ttlSeconds: HOLD_TTL_SECONDS,
      createdByUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })

    invalidateAvailabilityCache(ctx.salonId)
    return { holdId, expiresAt: expiresAt.toISOString() }
  },
)

/** Give the time back the moment a client navigates away from checkout. */
export const releaseHoldAction = withAuthz(
  {
    action: 'hold.release',
    schema: z.object({ holdId: cuid }),
    resource: async (input, ctx) => {
      const hold = await unsafeDb.bookingHold.findFirst({
        where: { id: input.holdId, salonId: ctx.salonId },
        select: { clientProfileId: true, primaryStylistId: true },
      })
      if (!hold) throw new DomainError('NOT_FOUND', 'That hold no longer exists.')
      return {
        salonId: ctx.salonId,
        clientProfileId: hold.clientProfileId,
        ownerStylistId: hold.primaryStylistId,
      }
    },
  },
  async (input, ctx) => {
    await releaseHold(ctx.salonId, input.holdId)
    invalidateAvailabilityCache(ctx.salonId)
    return { released: true }
  },
)

/**
 * Confirm.
 *
 * Prices and durations come from the frozen plan, never from the request: what
 * the client agreed to at approval is what they are booked and charged for,
 * regardless of what the catalog says today or what the browser posts.
 */
export const confirmBookingAction = withAuthz(
  {
    action: 'appointment.book',
    schema: z.object({
      holdId: cuid,
      servicePlanId: cuid,
      sequence: z.number().int().min(1).max(12),
      clientNote: z.string().max(2000).nullish(),
    }),
    resource: (input, ctx) => planResource(input.servicePlanId, ctx),
    auditAs: (_input, result) => ({
      entityType: 'Appointment',
      entityId: (result as { appointmentId: string }).appointmentId,
    }),
  },
  async (input, ctx) => {
    const plan = await loadPlan(ctx.salonId, input.servicePlanId)
    const session = plan.sessions.find((s) => s.sequence === input.sequence)
    if (!session) throw new DomainError('NOT_FOUND', 'That session is not part of this plan.')
    if (session.appointment) throw new DomainError('CONFLICT', 'That session is already booked.')

    const booking = await bookFromHold({
      salonId: ctx.salonId,
      holdId: input.holdId,
      clientProfileId: plan.clientProfileId,
      services: session.services.map((s) => ({
        serviceId: s.serviceId,
        serviceVariantId: s.serviceVariantId,
        plannedDurationMin: s.plannedDurationMin,
        priceCents: s.plannedPriceCents,
      })),
      consultationId: plan.consultationId,
      source: ctx.principal.kind === 'client' ? 'CLIENT_PORTAL' : 'FRONT_DESK',
      clientNote: input.clientNote ?? null,
      createdByUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
      depositCents: session.sequence === 1 ? (plan.depositCents ?? 0) : 0,
      timeZone: ctx.timezone,
    })

    invalidateAvailabilityCache(ctx.salonId)
    revalidatePath(`/s/${ctx.salonSlug}/my`)
    revalidatePath(`/s/${ctx.salonSlug}/my/appointments`)

    /*
     * Ask the card for the deposit now, outside the booking transaction.
     *
     * The row `bookFromHold` wrote is PENDING — owed, not held — and until
     * this it stayed that way forever: `DepositStatus` had seven values and
     * only three were ever written, none of them by an update. A deposit that
     * is never asked for is a deposit policy that does not exist.
     *
     * A decline does NOT fail the booking. The client picked a time, the slot
     * is theirs, and the salon would far rather have the appointment and a
     * conversation about the card than neither. The status comes back so the
     * screen can say which happened.
     */
    let deposit: { status: string; failureMessage?: string | null } | null = null
    if (booking.depositId) {
      try {
        deposit = await authorizeDeposit({
          salonId: ctx.salonId,
          depositId: booking.depositId,
          currency: ctx.currency,
        })
      } catch (error) {
        deposit = { status: 'PENDING', failureMessage: String(error) }
      }
    }

    return {
      appointmentId: booking.appointmentId,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      depositStatus: deposit?.status ?? null,
    }
  },
)

/**
 * Cancel.
 *
 * `appointment.cancelOwn` is what a client holds; staff cancelling somebody
 * else's appointment go through `appointment.cancelAny`, which the policy layer
 * additionally requires a written reason for. Choosing the action from the
 * principal keeps that distinction in the policy rather than in an if here.
 */
export const cancelBookingAction = withAuthz(
  {
    action: 'appointment.cancelOwn',
    schema: z.object({
      appointmentId: cuid,
      reason: z.string().max(500).nullish(),
    }),
    resource: (input, ctx) => appointmentResource(input.appointmentId, ctx),
    auditAs: (input) => ({ entityType: 'Appointment', entityId: input.appointmentId }),
  },
  async (input, ctx) => {
    await cancelAppointment({
      salonId: ctx.salonId,
      appointmentId: input.appointmentId,
      reason: input.reason ?? null,
      cancelledByUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })

    invalidateAvailabilityCache(ctx.salonId)
    revalidatePath(`/s/${ctx.salonSlug}/my/appointments`)
    return { cancelled: true }
  },
)

// --- Booking from behind the desk -------------------------------------------

/*
 * Hoisted for the reason every schema in this codebase is hoisted: a `'use
 * server'` module may only export async functions, and a `.refine()` arrow
 * living inside an exported const's initializer is rejected at BUILD time
 * while typecheck and lint both pass it.
 */
const DESK_SEARCH = z.object({
  clientProfileId: cuid,
  serviceIds: z.array(cuid).min(1).max(6),
  fromDate: localDate,
  toDate: localDate,
  locationId: cuid.nullish(),
  stylistId: cuid.nullish(),
  /**
   * Fill this processing gap, rather than searching the open diary.
   *
   * A segment id, not a start and end time. A window a browser can type is a
   * window a browser can widen, and "book me into this gap" quietly becoming
   * "book me anywhere" is not a mistake worth leaving available.
   */
  fillSegmentId: cuid.nullish(),
})

const DESK_BOOK = z.object({
  clientProfileId: cuid,
  serviceIds: z.array(cuid).min(1).max(6),
  token: z.string().min(1).max(200),
  locationId: cuid.nullish(),
  stylistId: cuid.nullish(),
  clientNote: z.string().max(2000).nullish(),
  overrideReason: z.string().max(500).nullish(),
  fillSegmentId: cuid.nullish(),
})

/**
 * What the desk needs to know before it offers anybody a time.
 *
 * Answered before the search, not after it, because a desk that says
 * "Thursday at two?" out loud and then discovers the client needs a patch test
 * has already made a promise it has to take back.
 */
export const deskBookingContextAction = withAuthz(
  {
    action: 'appointment.bookDirect',
    schema: z.object({ clientProfileId: cuid, serviceIds: z.array(cuid).min(1).max(6) }),
    resource: (input, ctx) => clientResource(input.clientProfileId, ctx),
  },
  async (input, ctx) => {
    const context = await deskBookingContext({ salonId: ctx.salonId, ...input })
    return {
      ...context,
      /*
       * Whether THIS person can sign it off, resolved here rather than in the
       * browser. The screen needs to know which button to draw, and "can I
       * override" is not a question a screen gets to answer for itself.
       */
      mayOverride: can(ctx.principal, 'appointment.bookWithoutConsultation', {
        salonId: ctx.salonId,
        clientProfileId: input.clientProfileId,
      }).allowed,
    }
  },
)

/** Times for an arbitrary basket, with no plan behind it. Read-only. */
export const findDeskSlotsAction = withAuthz(
  {
    action: 'appointment.bookDirect',
    schema: DESK_SEARCH,
    resource: (input, ctx) => clientResource(input.clientProfileId, ctx),
  },
  async (input, ctx) => {
    if (input.toDate < input.fromDate) {
      throw new DomainError('INVALID_INPUT', 'That date range runs backwards.')
    }

    const client = await unsafeDb.clientProfile.findFirstOrThrow({
      where: { id: input.clientProfileId, salonId: ctx.salonId },
      select: { completedVisits: true },
    })

    /*
     * Filling a gap narrows the whole search to that gap and that stylist. It
     * is loaded server-side from the segment, so what comes back is what is
     * actually in the diary rather than what was posted.
     */
    const gap = input.fillSegmentId ? await loadGap(ctx.salonId, input.fillSegmentId) : null

    return findSlotsForServices({
      salonId: ctx.salonId,
      serviceIds: input.serviceIds,
      fromDate: gap?.localDate ?? input.fromDate,
      toDate: gap?.localDate ?? input.toDate,
      locationId: input.locationId,
      stylistId: gap?.stylistId ?? input.stylistId,
      window: gap?.window ?? null,
      /*
       * Some stylists are closed to new clients, and the solver already knows
       * how to honour that — it was simply never told who was new.
       *
       * Visits COMPLETED, not appointments booked. Somebody who booked once
       * and cancelled has never sat in the chair, and counting that as
       * "returning" would walk them past a stylist who is closed to new
       * clients on the strength of an appointment that never happened.
       */
      isNewClient: client.completedVisits === 0,
    })
  },
)

/**
 * Put it in the diary.
 *
 * `appointment.bookDirect` rather than the override action, because most desk
 * bookings are a haircut and requiring a manager for those would be absurd.
 * The override is checked INSIDE, only for the baskets that need it, and the
 * service refuses if the caller does not hold it — so the permission is as
 * narrow as the thing it protects.
 */
export const bookFromDeskAction = withAuthz(
  {
    action: 'appointment.bookDirect',
    schema: DESK_BOOK,
    resource: (input, ctx) => clientResource(input.clientProfileId, ctx),
    auditAs: (_input, result) => ({
      entityType: 'Appointment',
      entityId: (result as { appointmentId: string }).appointmentId,
    }),
  },
  async (input, ctx) => {
    // Re-loaded on the write, not carried from the search. The gap may have
    // been cancelled in the seconds since, and a window taken on trust is a
    // window that no longer describes anything.
    const gap = input.fillSegmentId ? await loadGap(ctx.salonId, input.fillSegmentId) : null

    const booking = await bookFromDesk({
      salonId: ctx.salonId,
      clientProfileId: input.clientProfileId,
      serviceIds: input.serviceIds,
      token: input.token,
      locationId: input.locationId,
      stylistId: gap?.stylistId ?? input.stylistId,
      window: gap?.window ?? null,
      clientNote: input.clientNote ?? null,
      overrideReason: input.overrideReason ?? null,
      mayOverride: can(ctx.principal, 'appointment.bookWithoutConsultation', {
        salonId: ctx.salonId,
        clientProfileId: input.clientProfileId,
      }).allowed,
      createdByUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
      timeZone: ctx.timezone,
    })

    invalidateAvailabilityCache(ctx.salonId)
    revalidatePath(`/s/${ctx.salonSlug}/desk`)
    revalidatePath(`/s/${ctx.salonSlug}/desk/calendar`)

    return {
      appointmentId: booking.appointmentId,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
    }
  },
)

// --- "Come in and let me look at it" -----------------------------------------

const CONSULT_SEARCH = z.object({
  consultationId: cuid,
  fromDate: localDate,
  toDate: localDate,
})

async function consultationResource(consultationId: string, ctx: TenantContext) {
  const consultation = await unsafeDb.consultation.findFirst({
    where: { id: consultationId, salonId: ctx.salonId },
    select: { clientProfileId: true, requestedStylistId: true },
  })
  if (!consultation) throw new DomainError('NOT_FOUND', 'That consultation no longer exists.')
  return {
    salonId: ctx.salonId,
    clientProfileId: consultation.clientProfileId,
    ownerStylistId: consultation.requestedStylistId,
  }
}

/** Times with the stylist who asked to see them. Read-only. */
export const findConsultSlotsAction = withAuthz(
  {
    action: 'appointment.book',
    schema: CONSULT_SEARCH,
    resource: (input, ctx) => consultationResource(input.consultationId, ctx),
  },
  async (input, ctx) => {
    if (input.toDate < input.fromDate) {
      throw new DomainError('INVALID_INPUT', 'That date range runs backwards.')
    }
    return findConsultSlots({ salonId: ctx.salonId, ...input })
  },
)

/**
 * Book the thirty minutes.
 *
 * No deposit, no plan, no services — a conversation is not work, and putting a
 * £0 line on a bill to make the data model tidier would show the client a
 * product that does not exist.
 */
export const bookConsultAppointmentAction = withAuthz(
  {
    action: 'appointment.book',
    schema: z.object({ consultationId: cuid, token: z.string().min(1).max(200) }),
    resource: (input, ctx) => consultationResource(input.consultationId, ctx),
    auditAs: (_input, result) => ({
      entityType: 'Appointment',
      entityId: (result as { appointmentId: string }).appointmentId,
    }),
  },
  async (input, ctx) => {
    const booking = await bookConsultAppointment({
      salonId: ctx.salonId,
      consultationId: input.consultationId,
      token: input.token,
      createdByUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
      timeZone: ctx.timezone,
    })

    invalidateAvailabilityCache(ctx.salonId)
    revalidatePath(`/s/${ctx.salonSlug}/my`)
    revalidatePath(`/s/${ctx.salonSlug}/my/appointments`)

    return {
      appointmentId: booking.appointmentId,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
    }
  },
)

// --- The waitlist ------------------------------------------------------------

const JOIN_WAITLIST = z.object({
  clientProfileId: cuid,
  serviceIds: z.array(cuid).min(1).max(6),
  earliestDate: localDate,
  latestDate: localDate,
  dayOfWeekMask: z.number().int().min(1).max(127).optional(),
  windowStartMinute: z.number().int().min(0).max(1440).optional(),
  windowEndMinute: z.number().int().min(0).max(1440).optional(),
  preferredStylistIds: z.array(cuid).max(6).optional(),
})

async function waitlistResource(entryId: string, ctx: TenantContext) {
  const entry = await unsafeDb.waitlistEntry.findFirst({
    where: { id: entryId, salonId: ctx.salonId },
    select: { clientProfileId: true },
  })
  if (!entry) throw new DomainError('NOT_FOUND', 'That waitlist entry no longer exists.')
  return { salonId: ctx.salonId, clientProfileId: entry.clientProfileId }
}

/**
 * Get on the list.
 *
 * `waitlist.manage` covers the desk adding somebody; a client adding
 * themselves goes through the same action against their own record, which the
 * policy layer scopes for them. `priority` is deliberately NOT in the schema —
 * a client who could set their own would set it to the maximum, and then it
 * would mean nothing.
 */
export const joinWaitlistAction = withAuthz(
  {
    action: 'waitlist.manage',
    schema: JOIN_WAITLIST,
    resource: (input, ctx) => clientResource(input.clientProfileId, ctx),
    auditAs: (input) => ({ entityType: 'ClientProfile', entityId: input.clientProfileId }),
  },
  async (input, ctx) => {
    const entry = await joinWaitlist({ salonId: ctx.salonId, ...input })
    revalidatePath(`/s/${ctx.salonSlug}/my`)
    return entry
  },
)

export const leaveWaitlistAction = withAuthz(
  {
    action: 'waitlist.manage',
    schema: z.object({ entryId: cuid }),
    resource: (input, ctx) => waitlistResource(input.entryId, ctx),
    auditAs: (input) => ({ entityType: 'WaitlistEntry', entityId: input.entryId }),
  },
  async (input, ctx) => {
    const result = await leaveWaitlist({ salonId: ctx.salonId, entryId: input.entryId })
    invalidateAvailabilityCache(ctx.salonId)
    revalidatePath(`/s/${ctx.salonSlug}/my`)
    return result
  },
)

/** Take the slot that came free. */
export const acceptWaitlistOfferAction = withAuthz(
  {
    action: 'appointment.book',
    schema: z.object({ entryId: cuid }),
    resource: (input, ctx) => waitlistResource(input.entryId, ctx),
    auditAs: (_input, result) => ({
      entityType: 'Appointment',
      entityId: (result as { appointmentId: string }).appointmentId,
    }),
  },
  async (input, ctx) => {
    const result = await acceptOffer({
      salonId: ctx.salonId,
      entryId: input.entryId,
      timeZone: ctx.timezone,
      actorUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })
    invalidateAvailabilityCache(ctx.salonId)
    revalidatePath(`/s/${ctx.salonSlug}/my`)
    revalidatePath(`/s/${ctx.salonSlug}/my/appointments`)
    return result
  },
)

/** Turn it down. Back on the list, not off it. */
export const declineWaitlistOfferAction = withAuthz(
  {
    action: 'waitlist.manage',
    schema: z.object({ entryId: cuid }),
    resource: (input, ctx) => waitlistResource(input.entryId, ctx),
    auditAs: (input) => ({ entityType: 'WaitlistEntry', entityId: input.entryId }),
  },
  async (input, ctx) => {
    const result = await declineOffer({ salonId: ctx.salonId, entryId: input.entryId })
    invalidateAvailabilityCache(ctx.salonId)
    revalidatePath(`/s/${ctx.salonSlug}/my`)
    return result
  },
)

// --- The whole plan, in one pass ---------------------------------------------

const WHOLE_PLAN = z.object({
  servicePlanId: cuid,
  fromDate: localDate,
  sameStylist: z.boolean().optional(),
})

/**
 * Can the whole sequence be fitted in? Read-only.
 *
 * Answered before it is offered, because "book all three visits" that then
 * fails is worse than never having offered it — the client has already decided
 * they want the whole thing.
 */
export const offerWholePlanAction = withAuthz(
  {
    action: 'appointment.book',
    schema: WHOLE_PLAN,
    resource: (input, ctx) => planResource(input.servicePlanId, ctx),
  },
  async (input, ctx) => offerWholePlan({ salonId: ctx.salonId, ...input }),
)

/** Take all of it. */
export const bookWholePlanAction = withAuthz(
  {
    action: 'appointment.book',
    schema: WHOLE_PLAN,
    resource: (input, ctx) => planResource(input.servicePlanId, ctx),
    auditAs: (input) => ({ entityType: 'ServicePlan', entityId: input.servicePlanId }),
  },
  async (input, ctx) => {
    const result = await bookWholePlan({
      salonId: ctx.salonId,
      ...input,
      createdByUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
      timeZone: ctx.timezone,
    })

    invalidateAvailabilityCache(ctx.salonId)
    revalidatePath(`/s/${ctx.salonSlug}/my`)
    revalidatePath(`/s/${ctx.salonSlug}/my/appointments`)
    return result
  },
)
