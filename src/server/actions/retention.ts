'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz } from './guard'
import { recordAftercare } from '@/server/services/retention'

/**
 * Aftercare, written at the chair.
 *
 * Behind `formula.write` rather than a new action: this is the same person
 * making the same kind of record about the same client at the same moment, and
 * a permission nobody can articulate the difference from is a permission that
 * gets granted to everybody.
 */

const cuid = z.string().min(1).max(64)

export const recordAftercareAction = withAuthz(
  {
    action: 'formula.write',
    schema: z.object({
      appointmentId: cuid,
      advice: z.string().max(4000),
      products: z
        .array(z.object({ retailProductId: cuid, reason: z.string().max(500).nullable() }))
        .max(20),
    }),
    auditAs: (input) => ({ entityType: 'Appointment', entityId: input.appointmentId }),
  },
  async (input, ctx) => {
    const result = await recordAftercare({
      salonId: ctx.salonId,
      appointmentId: input.appointmentId,
      advice: input.advice,
      products: input.products,
      byUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })

    revalidatePath(`/s/${ctx.salonSlug}/desk/appointment/${input.appointmentId}`)
    revalidatePath(`/s/${ctx.salonSlug}/my/timeline`)
    return result
  },
)
