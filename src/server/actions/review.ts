'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import { reviewConsultation, type ReviewDecision } from '@/server/services/service-plan'
import { claimForReview, resolveFlag } from '@/server/services/review-queue'
import { evaluateConsultation } from '@/server/services/consultation'
import { acceptSuggestion, rejectSuggestion, summariseConsultation } from '@/server/services/ai'
import { reviewDetail } from '@/server/services/review-queue'
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

/*
 * The days and times an approval is held to.
 *
 * Hoisted rather than inlined for the same reason `NEW_CLIENT` is in
 * `actions/client.ts`: a `'use server'` module may only export async
 * functions, and the arrow inside `.refine()` sits in an exported const's
 * initializer, which the compiler rejects outright.
 *
 * The refusals are the point. A mask of zero and a start past its end are both
 * windows no appointment can satisfy, and the failure mode is silent — the
 * client is simply told the salon is fully booked, forever. The same
 * conditions are a CHECK constraint on the table; this is the version that can
 * say why.
 */
const WINDOW = z
  .object({
    earliestDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish(),
    latestDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish(),
    dayOfWeekMask: z.number().int().min(1, 'Pick at least one day.').max(127),
    windowStartMinute: z.number().int().min(0).max(1440),
    windowEndMinute: z.number().int().min(0).max(1440),
  })
  .refine((w) => w.windowStartMinute < w.windowEndMinute, {
    message: 'The earliest start has to come before the latest.',
    path: ['windowEndMinute'],
  })
  .refine((w) => !w.earliestDate || !w.latestDate || w.earliestDate <= w.latestDate, {
    message: 'That date range runs backwards.',
    path: ['latestDate'],
  })

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
          window: WINDOW.nullish(),
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
     *
     * The window is deliberately not counted. Narrowing to Tuesday mornings is
     * a statement about the stylist's diary, not about the engine's estimate
     * being wrong, and filing it as a disagreement would put noise into exactly
     * the signal this distinction exists to keep clean.
     */
    const { window: _window, ...estimateOverrides } = input.overrides ?? {}
    const changed =
      input.overrides &&
      Object.values(estimateOverrides).some((value) => value !== null && value !== undefined)

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
            window: input.overrides.window
              ? {
                  earliestDate: input.overrides.window.earliestDate ?? null,
                  latestDate: input.overrides.window.latestDate ?? null,
                  dayOfWeekMask: input.overrides.window.dayOfWeekMask,
                  windowStartMinute: input.overrides.window.windowStartMinute,
                  windowEndMinute: input.overrides.window.windowEndMinute,
                }
              : null,
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

/**
 * Ask for a summary of a consultation.
 *
 * On demand rather than on page load: a stylist who reads the answers
 * themselves should not have been charged for a summary they never opened, and
 * the queue would otherwise generate one for every consultation nobody looks
 * at. Returns null when AI is off or the model failed — the screen works
 * without it, which is the whole point of it being advisory.
 */
export const summariseAction = withAuthz(
  {
    action: 'consultation.review',
    schema: z.object({ consultationId: cuid }),
    resource: (input, ctx) => consultationResource(input.consultationId, ctx),
  },
  async (input, ctx) => {
    const detail = await reviewDetail(ctx.salonId, input.consultationId)
    if (!detail.evaluation) {
      throw new DomainError('CONFLICT', 'This consultation has not been evaluated yet.')
    }

    const result = await summariseConsultation({
      salonId: ctx.salonId,
      consultationId: input.consultationId,
      evaluation: detail.evaluation,
      answers: Object.fromEntries(
        detail.answered.filter((a) => a.wasAnswered).map((a) => [a.key, a.answer]),
      ),
      serviceNames: detail.services.map((service) => service.name),
    })

    return { summary: result.value, suggestionId: result.suggestionId }
  },
)

/**
 * A person takes responsibility for what the model said.
 *
 * Nothing an AI produces is used until this runs, and the edited copy is
 * stored beside the original so a salon can see the difference — which is both
 * the audit trail and the only honest measure of how good the suggestions are.
 */
export const judgeSuggestionAction = withAuthz(
  {
    action: 'aiSuggestion.accept',
    schema: z.object({
      suggestionId: cuid,
      accept: z.boolean(),
      edited: z.unknown().optional(),
    }),
    auditAs: (input) => ({ entityType: 'AiSuggestion', entityId: input.suggestionId }),
  },
  async (input, ctx) => {
    const userId = ctx.principal.kind === 'system' ? 'system' : ctx.principal.userId

    if (input.accept) {
      await acceptSuggestion({
        salonId: ctx.salonId,
        suggestionId: input.suggestionId,
        userId,
        edited: input.edited,
      })
    } else {
      await rejectSuggestion({ salonId: ctx.salonId, suggestionId: input.suggestionId, userId })
    }

    return { accepted: input.accept }
  },
)
