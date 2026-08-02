'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import { reviewConsultation, type ReviewDecision } from '@/server/services/service-plan'
import { claimForReview, resolveFlag } from '@/server/services/review-queue'
import { evaluateConsultation } from '@/server/services/consultation'
import { unsafeDb } from '@/server/db/client'
import type { TenantContext } from '@/server/auth/context'

/**
 * The stylist's decision.
 *
 * The engine recommends; a person decides. Every decision here is recorded
 * against the exact evaluation the reviewer saw, which is what lets a salon
 * answer "why did we quote that?" six months later — and what makes the
 * calibration loop honest, because an override is data about the engine being
 * wrong rather than a silent correction.
 */

const cuid = z.string().min(1).max(64)

async function consultationResource(consultationId: string, ctx: TenantContext) {
  const row = await unsafeDb.consultation.findFirst({
    where: { id: consultationId, salonId: ctx.salonId },
    select: { clientProfileId: true, requestedStylistId: true },
  })
  if (!row) throw new DomainError('NOT_FOUND', 'That consultation no longer exists.')
  return {
    salonId: ctx.salonId,
    clientProfileId: row.clientProfileId,
    ownerStylistId: row.requestedStylistId,
  }
}

/** Take it off the queue so two stylists do not review the same consultation. */
export const claimReviewAction = withAuthz(
  {
    action: 'consultation.review',
    schema: z.object({ consultationId: cuid }),
    resource: (input, ctx) => consultationResource(input.consultationId, ctx),
  },
  async (input, ctx) => {
    await claimForReview(
      ctx.salonId,
      input.consultationId,
      ctx.principal.kind === 'staff' ? ctx.principal.stylistProfileId : null,
    )
    revalidatePath(`/s/${ctx.salonSlug}/review`)
    return { claimed: true }
  },
)

const DECISIONS = [
  'APPROVE',
  'APPROVE_WITH_CHANGES',
  'REQUEST_IN_PERSON',
  'REQUEST_MORE_PHOTOS',
  'REQUEST_MORE_INFO',
  'DECLINE',
] as const

export const decideReviewAction = withAuthz(
  {
    action: 'consultation.review',
    schema: z.object({
      consultationId: cuid,
      decision: z.enum(DECISIONS),
      notesInternal: z.string().max(4000).nullish(),
      notesToClient: z.string().max(4000).nullish(),
      overrides: z
        .object({
          durationMin: z.number().int().min(5).max(1440).nullish(),
          priceCents: z.number().int().min(0).max(10_000_00).nullish(),
          depositCents: z.number().int().min(0).max(10_000_00).nullish(),
          stylistProfileId: cuid.nullish(),
        })
        .optional(),
    }),
    resource: (input, ctx) => consultationResource(input.consultationId, ctx),
    auditAs: (input) => ({ entityType: 'Consultation', entityId: input.consultationId }),
  },
  async (input, ctx) => {
    if (ctx.principal.kind === 'client') {
      throw new DomainError('FORBIDDEN', 'Only the salon can decide a consultation.')
    }

    /*
     * A stylist changing the price or duration must not silently disagree with
     * the decision label. APPROVE_WITH_CHANGES is what records that the human
     * and the engine differed, which is the input the calibration loop needs —
     * an override filed as a plain approval looks like the engine got it right.
     */
    const changed =
      input.overrides &&
      Object.values(input.overrides).some((value) => value !== null && value !== undefined)

    const decision: ReviewDecision =
      changed && input.decision === 'APPROVE' ? 'APPROVE_WITH_CHANGES' : input.decision

    const result = await reviewConsultation({
      salonId: ctx.salonId,
      consultationId: input.consultationId,
      reviewerUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
      decision,
      notesInternal: input.notesInternal ?? null,
      notesToClient: input.notesToClient ?? null,
      overrides: input.overrides
        ? {
            durationMin: input.overrides.durationMin ?? null,
            priceCents: input.overrides.priceCents ?? null,
            depositCents: input.overrides.depositCents ?? null,
            stylistProfileId: input.overrides.stylistProfileId ?? null,
          }
        : undefined,
    })

    revalidatePath(`/s/${ctx.salonSlug}/review`)
    revalidatePath(`/s/${ctx.salonSlug}/review/${input.consultationId}`)
    return result
  },
)

/**
 * A stylist's judgement on a single flag.
 *
 * Overriding is the one place a person overrules the engine on safety, so the
 * reason is mandatory and the record of who did it is the point. The policy
 * layer separates overriding a blocker from overriding anything else.
 */
export const resolveFlagAction = withAuthz(
  {
    action: 'flag.override',
    schema: z.object({
      consultationId: cuid,
      flagId: cuid,
      status: z.enum(['ACKNOWLEDGED', 'OVERRIDDEN', 'RESOLVED']),
      reason: z.string().max(2000).nullish(),
    }),
    resource: (input, ctx) => consultationResource(input.consultationId, ctx),
    auditAs: (input) => ({ entityType: 'RiskFlag', entityId: input.flagId }),
  },
  async (input, ctx) => {
    if (ctx.principal.kind === 'client') {
      throw new DomainError('FORBIDDEN', 'Only the salon can resolve a risk flag.')
    }

    await resolveFlag({
      salonId: ctx.salonId,
      flagId: input.flagId,
      status: input.status,
      userId: ctx.principal.kind === 'system' ? 'system' : ctx.principal.userId,
      reason: input.reason ?? null,
    })

    revalidatePath(`/s/${ctx.salonSlug}/review/${input.consultationId}`)
    return { resolved: true }
  },
)

/**
 * Run the rules again after a stylist corrects a fact.
 *
 * Inserts a new evaluation rather than editing the old one — an approval must
 * stay attached to exactly the inputs and outputs the reviewer saw.
 */
export const reevaluateAction = withAuthz(
  {
    action: 'consultation.review',
    schema: z.object({ consultationId: cuid }),
    resource: (input, ctx) => consultationResource(input.consultationId, ctx),
    auditAs: (input) => ({ entityType: 'Consultation', entityId: input.consultationId }),
  },
  async (input, ctx) => {
    const evaluation = await evaluateConsultation({
      salonId: ctx.salonId,
      consultationId: input.consultationId,
      trigger: 'STAFF_EDIT',
      actorUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })
    revalidatePath(`/s/${ctx.salonSlug}/review/${input.consultationId}`)
    return { evaluation }
  },
)
