'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import { unsafeDb } from '@/server/db/client'
import { cancelMembership, changePlan, subscribeClient } from '@/server/services/memberships'

/**
 * Selling, changing and stopping a membership.
 *
 * All behind `billing.manage` except the sale itself, which the front desk does
 * — somebody standing at the counter asking to join should not have to wait for
 * an owner. Changing a plan and cancelling move money and are the two a client
 * disputes afterwards, so they stay with whoever answers for the money.
 */

const cuid = z.string().min(1).max(64)

export const subscribeClientAction = withAuthz(
  {
    action: 'payment.take',
    schema: z.object({ clientProfileId: cuid, planId: cuid }),
    resource: (input, ctx) => ({ salonId: ctx.salonId, clientProfileId: input.clientProfileId }),
    auditAs: (input) => ({ entityType: 'ClientProfile', entityId: input.clientProfileId }),
  },
  async (input, ctx) => {
    const result = await subscribeClient({
      salonId: ctx.salonId,
      clientProfileId: input.clientProfileId,
      planId: input.planId,
    })
    revalidatePath(`/s/${ctx.salonSlug}/desk/clients/${input.clientProfileId}`)
    return result
  },
)

export const changeMembershipPlanAction = withAuthz(
  {
    action: 'billing.manage',
    schema: z.object({ membershipId: cuid, newPlanId: cuid }),
    auditAs: (input) => ({ entityType: 'ClientMembership', entityId: input.membershipId }),
  },
  async (input, ctx) => {
    const result = await changePlan({
      salonId: ctx.salonId,
      membershipId: input.membershipId,
      newPlanId: input.newPlanId,
    })
    revalidatePath(`/s/${ctx.salonSlug}/desk/clients`)
    return result
  },
)

export const cancelMembershipAction = withAuthz(
  {
    action: 'billing.manage',
    schema: z.object({
      membershipId: cuid,
      /*
       * Ending it today rather than at the period end takes back something the
       * client has paid for, so it is a deliberate choice somebody makes rather
       * than the default — and it is audited.
       */
      immediately: z.boolean().default(false),
    }),
    auditAs: (input) => ({ entityType: 'ClientMembership', entityId: input.membershipId }),
  },
  async (input, ctx) => {
    const result = await cancelMembership({
      salonId: ctx.salonId,
      membershipId: input.membershipId,
      immediately: input.immediately,
    })
    revalidatePath(`/s/${ctx.salonSlug}/desk/clients`)
    return result
  },
)

export const saveMembershipPlanAction = withAuthz(
  {
    action: 'billing.manage',
    schema: z.object({
      planId: cuid.nullable(),
      name: z.string().min(1).max(120),
      descriptionText: z.string().max(1000).nullable(),
      priceCents: z.number().int().min(0).max(1_000_000),
      interval: z.enum(['MONTH', 'YEAR']),
      isActive: z.boolean(),
      included: z
        .array(
          z.object({
            kind: z.enum(['FREE', 'PERCENT_OFF', 'FIXED_OFF']),
            label: z.string().min(1).max(120),
            serviceId: cuid.nullable(),
            value: z.number().int().min(0).max(1_000_000),
            perPeriod: z.number().int().min(1).max(99).nullable(),
          }),
        )
        .max(10),
    }),
    auditAs: (input) => ({ entityType: 'ClientMembershipPlan', entityId: input.planId }),
  },
  async (input, ctx) => {
    /*
     * A service named in a benefit has to be this salon's. `includedJson` is an
     * untyped column with no foreign keys in it, so nothing else would object
     * to another salon's id — and the till would then hand out a benefit
     * against a service this salon does not sell.
     */
    const serviceIds = [...new Set(input.included.flatMap((i) => (i.serviceId ? [i.serviceId] : [])))]
    if (serviceIds.length > 0) {
      const ours = await unsafeDb.service.count({
        where: { salonId: ctx.salonId, id: { in: serviceIds } },
      })
      if (ours !== serviceIds.length) {
        throw new DomainError('INVALID_INPUT', 'One of those services is not one of yours.')
      }
    }

    const data = {
      name: input.name,
      descriptionText: input.descriptionText,
      priceCents: input.priceCents,
      interval: input.interval,
      isActive: input.isActive,
      includedJson: input.included as unknown as object,
    }

    /*
     * Scoped by `updateMany`, not `update`.
     *
     * `update` takes a unique where and would happily edit another salon's plan
     * from a guessed id — the guard checks the ACTION, and nothing about a bare
     * plan id says whose it is. `updateMany` lets the salon be part of the
     * predicate, and a count of zero is somebody reaching where they should not.
     */
    if (input.planId) {
      const changed = await unsafeDb.clientMembershipPlan.updateMany({
        where: { id: input.planId, salonId: ctx.salonId },
        data,
      })
      if (changed.count === 0) throw new DomainError('NOT_FOUND', 'That plan is not one of yours.')
    }

    const plan = input.planId
      ? { id: input.planId }
      : await unsafeDb.clientMembershipPlan.create({
          data: { salonId: ctx.salonId, ...data },
          select: { id: true },
        })

    revalidatePath(`/s/${ctx.salonSlug}/admin/memberships`)
    return { planId: plan.id }
  },
)
