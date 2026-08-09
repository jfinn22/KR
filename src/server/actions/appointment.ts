'use server'

import { dbFor } from '@/server/db/tenant-client'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import { advanceAppointment, markProcessing } from '@/server/services/appointment-lifecycle'
import { invalidateAvailabilityCache } from '@/server/services/scheduling/loader'
import type { TenantContext } from '@/server/auth/context'

/**
 * The day-of actions.
 *
 * Every one of these is a tap somebody makes while standing up, often with a
 * client in front of them, so they are single-purpose and idempotent-ish: the
 * lifecycle refuses an impossible transition with a sentence a human can act
 * on rather than silently doing nothing.
 */

const cuid = z.string().min(1).max(64)

async function appointmentResource(appointmentId: string, ctx: TenantContext) {
  const appointment = await dbFor(ctx.salonId).appointment.findFirst({
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

function refresh(ctx: TenantContext) {
  revalidatePath(`/s/${ctx.salonSlug}/desk`)
  revalidatePath(`/s/${ctx.salonSlug}/today`)
}

export const checkInAction = withAuthz(
  {
    action: 'appointment.checkIn',
    schema: z.object({ appointmentId: cuid }),
    resource: (input, ctx) => appointmentResource(input.appointmentId, ctx),
    auditAs: (input) => ({ entityType: 'Appointment', entityId: input.appointmentId }),
  },
  async (input, ctx) => {
    const result = await advanceAppointment({
      salonId: ctx.salonId,
      appointmentId: input.appointmentId,
      step: 'CHECK_IN',
      actorUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })
    refresh(ctx)
    return result
  },
)

/**
 * Start and finish the chair.
 *
 * The two timestamps calibration is built on. Booked time expands to fill the
 * slot, so an estimate calibrated on it would only ever confirm itself; chair
 * time is the number that can disagree.
 */
export const startChairAction = withAuthz(
  {
    action: 'appointment.checkIn',
    schema: z.object({ appointmentId: cuid }),
    resource: (input, ctx) => appointmentResource(input.appointmentId, ctx),
    auditAs: (input) => ({ entityType: 'Appointment', entityId: input.appointmentId }),
  },
  async (input, ctx) => {
    const result = await advanceAppointment({
      salonId: ctx.salonId,
      appointmentId: input.appointmentId,
      step: 'START_CHAIR',
      actorUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })
    refresh(ctx)
    return result
  },
)

export const endChairAction = withAuthz(
  {
    action: 'appointment.checkIn',
    schema: z.object({ appointmentId: cuid }),
    resource: (input, ctx) => appointmentResource(input.appointmentId, ctx),
    auditAs: (input) => ({ entityType: 'Appointment', entityId: input.appointmentId }),
  },
  async (input, ctx) => {
    const result = await advanceAppointment({
      salonId: ctx.salonId,
      appointmentId: input.appointmentId,
      step: 'END_CHAIR',
      actorUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })
    invalidateAvailabilityCache(ctx.salonId)
    refresh(ctx)
    return result
  },
)

/** Colour is on and the stylist is free — the fact that makes interleaving real. */
export const markProcessingAction = withAuthz(
  {
    action: 'appointment.checkIn',
    schema: z.object({
      appointmentId: cuid,
      untilMinutes: z.number().int().min(5).max(180),
    }),
    resource: (input, ctx) => appointmentResource(input.appointmentId, ctx),
  },
  async (input, ctx) => {
    await markProcessing({
      salonId: ctx.salonId,
      appointmentId: input.appointmentId,
      untilMinutes: input.untilMinutes,
    })
    refresh(ctx)
    return { processing: true }
  },
)

/**
 * No-show.
 *
 * A separate action from cancel, and separately permissioned, because it costs
 * the client something: it increments their no-show count, which the rules
 * engine reads when deciding a deposit. Marking one by mistake is a real harm,
 * so the policy layer requires the higher permission and a written reason.
 */
export const markNoShowAction = withAuthz(
  {
    action: 'appointment.markNoShow',
    schema: z.object({
      appointmentId: cuid,
      reason: z.string().max(500).nullish(),
    }),
    resource: (input, ctx) => appointmentResource(input.appointmentId, ctx),
    auditAs: (input) => ({ entityType: 'Appointment', entityId: input.appointmentId }),
  },
  async (input, ctx) => {
    const result = await advanceAppointment({
      salonId: ctx.salonId,
      appointmentId: input.appointmentId,
      step: 'NO_SHOW',
      actorUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })
    invalidateAvailabilityCache(ctx.salonId)
    refresh(ctx)
    return result
  },
)

export const checkOutAction = withAuthz(
  {
    action: 'appointment.checkIn',
    schema: z.object({ appointmentId: cuid }),
    resource: (input, ctx) => appointmentResource(input.appointmentId, ctx),
    auditAs: (input) => ({ entityType: 'Appointment', entityId: input.appointmentId }),
  },
  async (input, ctx) => {
    const result = await advanceAppointment({
      salonId: ctx.salonId,
      appointmentId: input.appointmentId,
      step: 'CHECK_OUT',
      actorUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })
    invalidateAvailabilityCache(ctx.salonId)
    refresh(ctx)
    return result
  },
)
