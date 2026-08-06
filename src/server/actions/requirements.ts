'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import { recordStrandTest, waiveRequirement } from '@/server/services/requirements'

/**
 * Answering the things the engine asked for.
 *
 * Two very different permissions. Recording a strand test is `formula.write` —
 * the person who did the test writes down what it showed, and that is stylist
 * work. Waiving a requirement is `requirement.waive`, which the golden matrix
 * grants to owners and managers as `AR`: allowed, with a reason, mandatory.
 * Going ahead without the test the rules demanded is a decision somebody has to
 * put their name to.
 */

const cuid = z.string().min(1).max(64)

export const recordStrandTestAction = withAuthz(
  {
    action: 'formula.write',
    schema: z.object({
      clientProfileId: cuid,
      consultationId: cuid.nullish(),
      servicePlanId: cuid.nullish(),
      startLevel: z.number().int().min(1).max(10).nullish(),
      liftAchievedLevel: z.number().int().min(1).max(10).nullish(),
      integrityAfter: z.enum(['POOR', 'FAIR', 'GOOD']).nullish(),
      resultNotes: z.string().max(2000).nullish(),
      decision: z.enum(['PROCEED', 'MODIFY', 'ABORT']),
    }),
    resource: (input, ctx) => ({ salonId: ctx.salonId, clientProfileId: input.clientProfileId }),
    auditAs: (_input, result) => ({
      entityType: 'StrandTest',
      entityId: (result as { strandTestId: string }).strandTestId,
    }),
  },
  async (input, ctx) => {
    if (ctx.principal.kind !== 'staff') {
      throw new DomainError('FORBIDDEN', 'Only staff can record a strand test.')
    }

    const result = await recordStrandTest({
      salonId: ctx.salonId,
      clientProfileId: input.clientProfileId,
      consultationId: input.consultationId ?? null,
      servicePlanId: input.servicePlanId ?? null,
      performedByUserId: ctx.principal.userId,
      startLevel: input.startLevel ?? null,
      liftAchievedLevel: input.liftAchievedLevel ?? null,
      integrityAfter: input.integrityAfter ?? null,
      resultNotes: input.resultNotes ?? null,
      decision: input.decision,
    })

    revalidatePath(`/s/${ctx.salonSlug}/desk/clients/${input.clientProfileId}`)
    return result
  },
)

export const waiveRequirementAction = withAuthz(
  {
    action: 'requirement.waive',
    schema: z.object({
      requirementId: cuid,
      /*
       * Named `reason` because that is the field `withAuthz` looks for when the
       * policy says a reason is required. Calling it anything else would let
       * the guard pass with nothing written down.
       */
      reason: z.string().min(8).max(500),
    }),
    auditAs: (input) => ({ entityType: 'PreRequirement', entityId: input.requirementId }),
  },
  async (input, ctx) => {
    if (ctx.principal.kind !== 'staff') {
      throw new DomainError('FORBIDDEN', 'Only staff can waive a requirement.')
    }

    const result = await waiveRequirement({
      salonId: ctx.salonId,
      requirementId: input.requirementId,
      waivedByUserId: ctx.principal.userId,
      reason: input.reason,
    })

    revalidatePath(`/s/${ctx.salonSlug}/desk`)
    return result
  },
)
