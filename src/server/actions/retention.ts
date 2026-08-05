'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import { unsafeDb } from '@/server/db/client'
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
    /*
     * `formula.write` is an OWN grant for stylists and assistants, and without a
     * resource the guard sees only a salon id — so the ownership test can never
     * be satisfied and the exact people who write aftercare are locked out of
     * writing it.
     */
    resource: async (input, ctx) => {
      const appointment = await ctx.db.appointment.findFirst({
        where: { id: input.appointmentId, salonId: ctx.salonId },
        select: { primaryStylistId: true, clientProfileId: true, locationId: true },
      })
      return {
        salonId: ctx.salonId,
        ownerStylistId: appointment?.primaryStylistId ?? null,
        clientProfileId: appointment?.clientProfileId ?? null,
        locationId: appointment?.locationId ?? null,
      }
    },
    auditAs: (input) => ({ entityType: 'Appointment', entityId: input.appointmentId }),
  },
  async (input, ctx) => {
    /*
     * Product ids arrive from the browser and are written to a foreign key that
     * carries no salon. Another salon's catalogue would be accepted, and then
     * read back and rendered on this client's record.
     */
    if (input.products.length > 0) {
      const ids = [...new Set(input.products.map((p) => p.retailProductId))]
      const ours = await unsafeDb.retailProduct.count({
        where: { salonId: ctx.salonId, id: { in: ids } },
      })
      if (ours !== ids.length) {
        throw new DomainError('INVALID_INPUT', 'One of those products is not one of yours.')
      }
    }

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
