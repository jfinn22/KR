'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import { findSlots, resolveSlot } from '@/server/services/scheduling/slots'
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
