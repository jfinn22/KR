'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz } from './guard'
import { recordUsage } from '@/server/services/backbar'

/**
 * What the bowl cost, recorded at the bowl.
 *
 * Behind `formula.write`, because it is the same person recording the same mix
 * at the same moment — the cost is a property of the formula, not a separate
 * thing a manager types up later from a receipt.
 */

const cuid = z.string().min(1).max(64)

export const recordUsageAction = withAuthz(
  {
    action: 'formula.write',
    schema: z.object({
      appointmentId: cuid,
      formulaId: cuid,
      /*
       * A kilo of colour in one bowl is a typo, not a balayage. Bounded so a
       * slipped decimal point does not put a four-figure product cost against
       * one appointment and skew a whole month's backbar figure.
       */
      anchorGrams: z.number().positive().max(2000),
      wasteGrams: z.number().min(0).max(2000),
    }),
    auditAs: (input) => ({ entityType: 'Appointment', entityId: input.appointmentId }),
  },
  async (input, ctx) => {
    const result = await recordUsage({
      salonId: ctx.salonId,
      appointmentId: input.appointmentId,
      formulaId: input.formulaId,
      anchorGrams: input.anchorGrams,
      wasteGrams: input.wasteGrams,
    })

    revalidatePath(`/s/${ctx.salonSlug}/desk/appointment/${input.appointmentId}`)
    return result
  },
)
