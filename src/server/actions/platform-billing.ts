'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz } from './guard'
import { choosePlatformPlan } from '@/server/services/platform-billing'

/**
 * The salon choosing what it pays this platform.
 *
 * Behind `billing.manage`, which is owner-only — a manager who can sell a
 * client membership still cannot change what the business itself is committed
 * to. Audited against `Subscription`, because the only question ever asked of
 * this record is who moved the salon onto a different plan, and when.
 */
export const choosePlatformPlanAction = withAuthz(
  {
    action: 'billing.manage',
    schema: z.object({
      planCode: z.enum(['STARTER', 'PRO', 'SALON']),
      yearly: z.boolean().default(false),
    }),
    auditAs: () => ({ entityType: 'Subscription' }),
  },
  async (input, ctx) => {
    const result = await choosePlatformPlan({
      salonId: ctx.salonId,
      planCode: input.planCode,
      yearly: input.yearly,
    })
    revalidatePath(`/s/${ctx.salonSlug}/admin/billing`)
    return result
  },
)
