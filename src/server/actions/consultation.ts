'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import {
  loadConsultation,
  saveAnswer,
  startConsultation,
  submitConsultation,
} from '@/server/services/consultation'
import { maybeAutoApprove } from '@/server/services/service-plan'
import { removeConsultationPhoto, tagInspiration } from '@/server/services/photos'
import { unsafeDb } from '@/server/db/client'
import type { TenantContext } from '@/server/auth/context'

/**
 * Consultation server actions.
 *
 * Thin by design: `withAuthz` has already resolved the tenant, validated the
 * input, checked the plan tier and the permission, demanded a written reason
 * where the policy requires one, and will write the audit row. What is left
 * here is the intent itself.
 */

const cuid = z.string().min(1).max(64)

/**
 * Whose consultation is this?
 *
 * Resolved from the row rather than from the caller, so a client cannot widen
 * their own scope by passing somebody else's id — the policy layer compares
 * this against the principal.
 */
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

/**
 * A client acts on their own profile; staff name the client explicitly.
 *
 * Front desk starting a consultation on the phone is the same action as a
 * client starting one at home, and it should not be a second code path.
 */
function actingClientProfileId(ctx: TenantContext, given: string | null | undefined): string {
  if (ctx.principal.kind === 'client') return ctx.principal.clientProfileId
  if (!given) throw new DomainError('INVALID_INPUT', 'Choose a client first.')
  return given
}

export const startConsultationAction = withAuthz(
  {
    action: 'consultation.create',
    schema: z.object({
      serviceIds: z.array(cuid).min(1, 'Choose at least one service.'),
      stylistProfileId: cuid.nullish(),
      clientProfileId: cuid.nullish(),
    }),
    auditAs: (_input, result) => ({
      entityType: 'Consultation',
      entityId: (result as { consultationId: string }).consultationId,
    }),
  },
  async (input, ctx) => {
    const clientProfileId = actingClientProfileId(ctx, input.clientProfileId)

    // Refuse a service this salon does not offer, rather than creating a
    // consultation that can never be evaluated.
    const count = await unsafeDb.service.count({
      where: { salonId: ctx.salonId, id: { in: input.serviceIds }, isActive: true },
    })
    if (count !== input.serviceIds.length) {
      throw new DomainError('INVALID_INPUT', 'One of those services is no longer offered.')
    }

    const consultationId = await startConsultation({
      salonId: ctx.salonId,
      clientProfileId,
      serviceIds: input.serviceIds,
      stylistProfileId: input.stylistProfileId ?? null,
    })
    return { consultationId }
  },
)

/**
 * Autosave.
 *
 * Called on every change, so it stays deliberately cheap: no evaluation, no
 * revalidation, no audit row. A client who closes the tab mid-question has
 * lost nothing, and a consultation nobody finishes books nothing.
 */
export const saveAnswerAction = withAuthz(
  {
    action: 'consultation.create',
    schema: z.object({
      consultationId: cuid,
      questionKey: z.string().min(1).max(64),
      value: z.unknown(),
    }),
    resource: (input, ctx) => consultationResource(input.consultationId, ctx),
  },
  async (input, ctx) => {
    await saveAnswer({
      salonId: ctx.salonId,
      consultationId: input.consultationId,
      questionKey: input.questionKey,
      value: input.value,
    })
    return { saved: true }
  },
)

/** Progress and branching, for the guided flow to re-render against. */
export const loadConsultationAction = withAuthz(
  {
    action: 'consultation.view',
    schema: z.object({ consultationId: cuid }),
    resource: (input, ctx) => consultationResource(input.consultationId, ctx),
  },
  async (input, ctx) => loadConsultation(ctx.salonId, input.consultationId),
)

/**
 * Submit, evaluate, and approve where the salon has said that is acceptable.
 *
 * The auto-approval attempt is intentionally inside the same action: a client
 * who finishes a straightforward consultation should land on a bookable plan,
 * not on a "we will get back to you" screen that a stylist has to clear by
 * hand. Anything flagged still waits for a person.
 */
/**
 * Say what you like about a reference photo.
 *
 * "I like this" is not a brief. Without attributes the stylist is guessing
 * whether the client means the tone, the brightness or the cut — and guessing
 * wrong is what produces a client unhappy with technically correct work.
 */
export const tagInspirationAction = withAuthz(
  {
    action: 'consultation.create',
    schema: z.object({
      consultationId: cuid,
      inspirationPhotoId: cuid,
      attributes: z
        .array(
          z.object({
            key: z.enum([
              'TARGET_LEVEL',
              'TARGET_TONE',
              'TECHNIQUE',
              'ROOT_SHADOW',
              'CONTRAST',
              'DIMENSION',
              'BRIGHTNESS',
              'CURLS',
            ]),
            value: z.string().min(1).max(120),
          }),
        )
        .max(12),
    }),
    resource: (input, ctx) => consultationResource(input.consultationId, ctx),
  },
  async (input, ctx) => {
    await tagInspiration({
      salonId: ctx.salonId,
      inspirationPhotoId: input.inspirationPhotoId,
      attributes: input.attributes,
      source: ctx.principal.kind === 'client' ? 'CLIENT' : 'STYLIST',
      acceptedByUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })
    return { tagged: true }
  },
)

/** Remove a photo a client no longer wants attached. */
export const removePhotoAction = withAuthz(
  {
    action: 'consultation.create',
    schema: z.object({ consultationId: cuid, consultationPhotoId: cuid }),
    resource: (input, ctx) => consultationResource(input.consultationId, ctx),
  },
  async (input, ctx) => {
    await removeConsultationPhoto(ctx.salonId, input.consultationPhotoId)
    return { removed: true }
  },
)

export const submitConsultationAction = withAuthz(
  {
    action: 'consultation.submit',
    schema: z.object({
      consultationId: cuid,
      clientNote: z.string().max(2000).nullish(),
    }),
    resource: (input, ctx) => consultationResource(input.consultationId, ctx),
    auditAs: (input) => ({ entityType: 'Consultation', entityId: input.consultationId }),
  },
  async (input, ctx) => {
    const evaluation = await submitConsultation({
      salonId: ctx.salonId,
      consultationId: input.consultationId,
      clientNote: input.clientNote ?? null,
    })

    const servicePlanId = await maybeAutoApprove({
      salonId: ctx.salonId,
      consultationId: input.consultationId,
      evaluation,
    })

    revalidatePath(`/s/${ctx.salonSlug}/my`)
    return { evaluation, servicePlanId }
  },
)
