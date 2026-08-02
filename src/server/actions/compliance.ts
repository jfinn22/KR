'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import {
  eraseClient,
  exportClientData,
  grantConsent,
  readPatchTest,
  recordPatchTest,
  revokeConsent,
  submitForm,
} from '@/server/services/compliance'
import { unsafeDb } from '@/server/db/client'
import type { TenantContext } from '@/server/auth/context'

/**
 * Consent, patch tests, and subject rights.
 *
 * Nothing here is legal advice and the shipped forms say so on their face.
 * What the code does guarantee is procedural: what somebody signed is frozen,
 * a patch test cannot be filed as clear before it has had time to react, and
 * an erasure is irreversible and audited.
 */

const cuid = z.string().min(1).max(64)

async function clientResource(clientProfileId: string, ctx: TenantContext) {
  const client = await unsafeDb.clientProfile.findFirst({
    where: { id: clientProfileId, salonId: ctx.salonId },
    select: { id: true, preferredStylistId: true },
  })
  if (!client) throw new DomainError('NOT_FOUND', 'That client is not on file.')
  return {
    salonId: ctx.salonId,
    clientProfileId: client.id,
    ownerStylistId: client.preferredStylistId,
  }
}

export const recordPatchTestAction = withAuthz(
  {
    action: 'hairAssessment.write',
    schema: z.object({
      clientProfileId: cuid,
      productBrand: z.string().max(80).nullish(),
      productRef: z.string().max(80).nullish(),
      servicePlanId: cuid.nullish(),
    }),
    resource: (input, ctx) => clientResource(input.clientProfileId, ctx),
    auditAs: (_input, result) => ({
      entityType: 'PatchTest',
      entityId: (result as { patchTestId: string }).patchTestId,
    }),
  },
  async (input, ctx) => {
    const result = await recordPatchTest({
      salonId: ctx.salonId,
      clientProfileId: input.clientProfileId,
      appliedAt: new Date(),
      productBrand: input.productBrand ?? null,
      productRef: input.productRef ?? null,
      servicePlanId: input.servicePlanId ?? null,
      appliedByUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })

    revalidatePath(`/s/${ctx.salonSlug}/desk/clients/${input.clientProfileId}`)
    return {
      patchTestId: result.patchTestId,
      readableFrom: result.readableFrom.toISOString(),
      validUntil: result.validUntil.toISOString(),
    }
  },
)

export const readPatchTestAction = withAuthz(
  {
    action: 'hairAssessment.write',
    schema: z.object({
      patchTestId: cuid,
      clientProfileId: cuid,
      result: z.enum(['NEGATIVE', 'POSITIVE', 'INCONCLUSIVE']),
      notes: z.string().max(1000).nullish(),
    }),
    resource: (input, ctx) => clientResource(input.clientProfileId, ctx),
    auditAs: (input) => ({ entityType: 'PatchTest', entityId: input.patchTestId }),
  },
  async (input, ctx) => {
    await readPatchTest({
      salonId: ctx.salonId,
      patchTestId: input.patchTestId,
      result: input.result,
      notes: input.notes ?? null,
    })

    revalidatePath(`/s/${ctx.salonSlug}/desk/clients/${input.clientProfileId}`)
    return { recorded: true }
  },
)

/**
 * Sign a form.
 *
 * A client signs for themselves; staff can capture a signature at the desk,
 * which is what `signerRelationship` is for — a guardian signing for a minor
 * is a different fact from the client signing, and the record has to say so.
 */
export const submitFormAction = withAuthz(
  {
    action: 'consultation.create',
    schema: z.object({
      formKey: z.string().min(1).max(64),
      clientProfileId: cuid.nullish(),
      answers: z.record(z.unknown()).optional(),
      appointmentId: cuid.nullish(),
      consultationId: cuid.nullish(),
      signerName: z.string().min(2, 'Type your name to sign.').max(120),
      signerRelationship: z.string().max(60).nullish(),
    }),
    resource: (input, ctx) => ({
      salonId: ctx.salonId,
      clientProfileId:
        ctx.principal.kind === 'client'
          ? ctx.principal.clientProfileId
          : (input.clientProfileId ?? undefined),
    }),
    auditAs: (_input, result) => ({
      entityType: 'FormSubmission',
      entityId: (result as { submissionId: string }).submissionId,
    }),
  },
  async (input, ctx) => {
    const clientProfileId =
      ctx.principal.kind === 'client' ? ctx.principal.clientProfileId : input.clientProfileId
    if (!clientProfileId) throw new DomainError('INVALID_INPUT', 'Choose a client first.')

    return submitForm({
      salonId: ctx.salonId,
      formKey: input.formKey,
      clientProfileId,
      answers: input.answers,
      appointmentId: input.appointmentId ?? null,
      consultationId: input.consultationId ?? null,
      signerName: input.signerName,
      signerRelationship: input.signerRelationship ?? null,
      signerUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })
  },
)

const GRANT_KINDS = [
  'PHOTO_RELEASE',
  'MARKETING_USE',
  'SMS',
  'EMAIL',
  'DATA_PROCESSING',
  'AI_PHOTO_ANALYSIS',
  'MINOR_GUARDIAN',
  'CHEMICAL_SERVICE',
  'EXTENSIONS',
  'CORRECTION_SERVICE',
] as const

/**
 * Turn a consent on or off.
 *
 * A client may always change their own. Staff can record one given in person,
 * which is a real and common case — but the record says who captured it.
 */
export const setConsentAction = withAuthz(
  {
    action: 'client.edit',
    schema: z.object({
      clientProfileId: cuid.nullish(),
      kind: z.enum(GRANT_KINDS),
      granted: z.boolean(),
    }),
    resource: (input, ctx) => ({
      salonId: ctx.salonId,
      clientProfileId:
        ctx.principal.kind === 'client'
          ? ctx.principal.clientProfileId
          : (input.clientProfileId ?? undefined),
    }),
    auditAs: (input) => ({ entityType: 'ConsentGrant', entityId: input.clientProfileId ?? null }),
  },
  async (input, ctx) => {
    const clientProfileId =
      ctx.principal.kind === 'client' ? ctx.principal.clientProfileId : input.clientProfileId
    if (!clientProfileId) throw new DomainError('INVALID_INPUT', 'Choose a client first.')

    if (input.granted) {
      await grantConsent({ salonId: ctx.salonId, clientProfileId, kind: input.kind })
    } else {
      await revokeConsent({ salonId: ctx.salonId, clientProfileId, kind: input.kind })
    }

    revalidatePath(`/s/${ctx.salonSlug}/desk/clients/${clientProfileId}`)
    return { granted: input.granted }
  },
)

/** Everything held about one person, as portable data. */
export const exportClientAction = withAuthz(
  {
    action: 'client.export',
    schema: z.object({ clientProfileId: cuid, reason: z.string().max(500).optional() }),
    resource: (input, ctx) => clientResource(input.clientProfileId, ctx),
    auditAs: (input) => ({ entityType: 'ClientProfile', entityId: input.clientProfileId }),
  },
  async (input, ctx) => exportClientData(ctx.salonId, input.clientProfileId),
)

/**
 * Erase a client.
 *
 * Irreversible, so the policy layer requires the highest permission and a
 * written reason, and the confirmation asks for the client's name typed out —
 * a click is too cheap for something that cannot be undone.
 */
export const eraseClientAction = withAuthz(
  {
    action: 'client.erase',
    schema: z.object({
      clientProfileId: cuid,
      reason: z.string().min(8, 'Record why this was requested.').max(500),
      /** Typed by the operator; must match the record being erased. */
      confirmName: z.string().min(1),
    }),
    resource: (input, ctx) => clientResource(input.clientProfileId, ctx),
    auditAs: (input) => ({ entityType: 'ClientProfile', entityId: input.clientProfileId }),
  },
  async (input, ctx) => {
    const client = await unsafeDb.clientProfile.findFirstOrThrow({
      where: { id: input.clientProfileId, salonId: ctx.salonId },
      select: { firstName: true, lastName: true, status: true },
    })

    if (client.status === 'ERASED') {
      throw new DomainError('CONFLICT', 'That client has already been erased.')
    }

    const expected = `${client.firstName} ${client.lastName}`.trim().toLowerCase()
    if (input.confirmName.trim().toLowerCase() !== expected) {
      throw new DomainError(
        'INVALID_INPUT',
        'The name typed does not match this client. Nothing has been changed.',
      )
    }

    const result = await eraseClient({
      salonId: ctx.salonId,
      clientProfileId: input.clientProfileId,
      requestedByUserId: ctx.principal.kind === 'system' ? 'system' : ctx.principal.userId,
      reason: input.reason,
    })

    revalidatePath(`/s/${ctx.salonSlug}/desk/clients`)
    return result
  },
)
