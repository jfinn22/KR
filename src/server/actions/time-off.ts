'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import { unsafeDb } from '@/server/db/client'
import { cancelTimeOff, decideTimeOff, requestTimeOff } from '@/server/services/time-off'

/**
 * Asking to be off, and deciding about it.
 *
 * Two different permissions on purpose. `schedule.editOwn` is granted to every
 * role including assistants, because asking for a day off is not a privilege;
 * `schedule.editAny` stops at manager, because agreeing to it costs the salon
 * bookings. Both already existed in the matrix — the actions did not.
 */

const cuid = z.string().min(1).max(64)

/**
 * Whose row this is, so the OWN grant can be tested.
 *
 * Without a resource resolver an OWN grant can never pass, so a stylist would
 * be refused their own request — the failure mode this codebase has hit before.
 */
async function timeOffResource(timeOffId: string, salonId: string) {
  const row = await unsafeDb.timeOff.findFirst({
    where: { id: timeOffId, salonId },
    select: { stylistProfileId: true },
  })
  if (!row) throw new DomainError('NOT_FOUND', 'That request is not here.')
  return { salonId, ownerStylistId: row.stylistProfileId }
}

export const requestTimeOffAction = withAuthz(
  {
    action: 'schedule.editOwn',
    schema: z.object({
      stylistProfileId: cuid,
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      allDay: z.boolean().default(false),
      reason: z.string().max(300).nullish(),
    }),
    resource: (input, ctx) => ({ salonId: ctx.salonId, ownerStylistId: input.stylistProfileId }),
    auditAs: (_input, result) => ({
      entityType: 'TimeOff',
      entityId: (result as { timeOffId: string }).timeOffId,
    }),
  },
  async (input, ctx) => {
    const result = await requestTimeOff({
      salonId: ctx.salonId,
      stylistProfileId: input.stylistProfileId,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      allDay: input.allDay,
      reason: input.reason ?? null,
    })
    revalidatePath(`/s/${ctx.salonSlug}/desk/time-off`)
    return result
  },
)

export const decideTimeOffAction = withAuthz(
  {
    action: 'schedule.editAny',
    schema: z.object({ timeOffId: cuid, approve: z.boolean() }),
    auditAs: (input) => ({ entityType: 'TimeOff', entityId: input.timeOffId }),
  },
  async (input, ctx) => {
    const result = await decideTimeOff({
      salonId: ctx.salonId,
      timeOffId: input.timeOffId,
      approve: input.approve,
      decidedByUserId: ctx.principal.kind === 'staff' ? ctx.principal.userId : null,
    })
    revalidatePath(`/s/${ctx.salonSlug}/desk/time-off`)
    revalidatePath(`/s/${ctx.salonSlug}/desk/calendar`)
    return result
  },
)

export const cancelTimeOffAction = withAuthz(
  {
    action: 'schedule.editOwn',
    schema: z.object({ timeOffId: cuid }),
    resource: (input, ctx) => timeOffResource(input.timeOffId, ctx.salonId),
    auditAs: (input) => ({ entityType: 'TimeOff', entityId: input.timeOffId }),
  },
  async (input, ctx) => {
    await cancelTimeOff({ salonId: ctx.salonId, timeOffId: input.timeOffId })
    revalidatePath(`/s/${ctx.salonSlug}/desk/time-off`)
    revalidatePath(`/s/${ctx.salonSlug}/desk/calendar`)
    return { ok: true }
  },
)
