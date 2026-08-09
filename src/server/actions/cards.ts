'use server'

import { dbFor } from '@/server/db/tenant-client'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import {
  beginCardSetup,
  completeCardSetupWithoutBrowser,
  removeCard,
  syncCards,
} from '@/server/services/cards'
import { forfeitDeposit, releaseDeposit } from '@/server/services/deposits'
import type { TenantContext } from '@/server/auth/context'

/**
 * Cards on file.
 *
 * `card.manage` rather than `payment.take`, and the distinction is the whole
 * reason this file is separate. Taking a payment is a one-off the client is
 * standing there for. Keeping a card is a standing permission to charge them
 * when they are not — which is a different thing to be trusted with, and a
 * different thing to be asked for.
 *
 * No card number passes through any of this. The browser talks to the
 * provider directly with a client secret; what comes back here is a reference.
 */

const cuid = z.string().min(1).max(64)

async function clientResource(clientProfileId: string, ctx: TenantContext) {
  const client = await dbFor(ctx.salonId).clientProfile.findFirst({
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

/**
 * Start collecting a card.
 *
 * Hands back a client secret and nothing else. Deliberately does not create a
 * `SavedCard` row: the card does not exist until the provider says it does,
 * and a row written optimistically here would tell a client they had a card on
 * file when their bank had declined the agreement.
 */
export const beginCardSetupAction = withAuthz(
  {
    action: 'card.manage',
    schema: z.object({ clientProfileId: cuid }),
    resource: (input, ctx) => clientResource(input.clientProfileId, ctx),
    auditAs: (input) => ({ entityType: 'ClientProfile', entityId: input.clientProfileId }),
  },
  async (input, ctx) =>
    beginCardSetup({ salonId: ctx.salonId, clientProfileId: input.clientProfileId }),
)

/**
 * The browser finished. Ask the provider what it actually holds.
 *
 * Called after Elements confirms, and it reads from the provider rather than
 * trusting what the browser posted — a client can post anything, and "which
 * cards may this salon charge" is not a question the client's browser gets to
 * answer.
 */
export const syncCardsAction = withAuthz(
  {
    action: 'card.manage',
    schema: z.object({ clientProfileId: cuid }),
    resource: (input, ctx) => clientResource(input.clientProfileId, ctx),
    auditAs: (input) => ({ entityType: 'ClientProfile', entityId: input.clientProfileId }),
  },
  async (input, ctx) => {
    const result = await syncCards({
      salonId: ctx.salonId,
      clientProfileId: input.clientProfileId,
    })
    revalidatePath(`/s/${ctx.salonSlug}/me`)
    return result
  },
)

/**
 * Finish a setup with no browser involved.
 *
 * Refused unless the mock adapter is live — `attachTestCard` does not exist on
 * the Stripe adapter, so configuring a real key makes this structurally
 * impossible rather than merely discouraged.
 */
export const completeCardSetupWithoutBrowserAction = withAuthz(
  {
    action: 'card.manage',
    schema: z.object({ clientProfileId: cuid, setupIntentId: z.string().min(1).max(200) }),
    resource: (input, ctx) => clientResource(input.clientProfileId, ctx),
    auditAs: (input) => ({ entityType: 'ClientProfile', entityId: input.clientProfileId }),
  },
  async (input, ctx) => {
    const result = await completeCardSetupWithoutBrowser({
      salonId: ctx.salonId,
      clientProfileId: input.clientProfileId,
      setupIntentId: input.setupIntentId,
    })
    revalidatePath(`/s/${ctx.salonSlug}/me`)
    return result
  },
)

/**
 * Take a card off file.
 *
 * Detached at the provider before it is marked removed here. The other order
 * leaves a client believing they had withdrawn permission they had not, which
 * is the one thing this feature must never do.
 */
export const removeCardAction = withAuthz(
  {
    action: 'card.manage',
    schema: z.object({ clientProfileId: cuid, savedCardId: cuid }),
    resource: (input, ctx) => clientResource(input.clientProfileId, ctx),
    auditAs: (input) => ({ entityType: 'SavedCard', entityId: input.savedCardId }),
  },
  async (input, ctx) => {
    const result = await removeCard({
      salonId: ctx.salonId,
      clientProfileId: input.clientProfileId,
      savedCardId: input.savedCardId,
    })
    revalidatePath(`/s/${ctx.salonSlug}/me`)
    return result
  },
)

async function depositResource(depositId: string, ctx: TenantContext) {
  const deposit = await dbFor(ctx.salonId).deposit.findFirst({
    where: { id: depositId, salonId: ctx.salonId },
    select: { clientProfileId: true },
  })
  if (!deposit) throw new DomainError('NOT_FOUND', 'That deposit no longer exists.')
  return { salonId: ctx.salonId, clientProfileId: deposit.clientProfileId }
}

/**
 * Keep a deposit, because nobody came.
 *
 * Reason-required at every level that holds `deposit.charge`. This takes money
 * from somebody who is not in the room and cannot argue at the time, so the
 * justification is written down before the charge, not reconstructed after a
 * complaint.
 */
export const forfeitDepositAction = withAuthz(
  {
    action: 'deposit.charge',
    schema: z.object({ depositId: cuid, reason: z.string().min(4).max(500) }),
    resource: (input, ctx) => depositResource(input.depositId, ctx),
    auditAs: (input) => ({ entityType: 'Deposit', entityId: input.depositId }),
  },
  async (input, ctx) =>
    forfeitDeposit({
      salonId: ctx.salonId,
      depositId: input.depositId,
      reason: input.reason,
    }),
)

/**
 * Let a hold go.
 *
 * Explicitly, rather than leaving it to expire. An authorisation allowed to
 * lapse sits on the client's statement for days looking like a charge, and
 * produces the phone call the deposit was supposed to prevent.
 */
export const releaseDepositAction = withAuthz(
  {
    action: 'deposit.charge',
    schema: z.object({ depositId: cuid, reason: z.string().min(4).max(500) }),
    resource: (input, ctx) => depositResource(input.depositId, ctx),
    auditAs: (input) => ({ entityType: 'Deposit', entityId: input.depositId }),
  },
  async (input, ctx) => releaseDeposit({ salonId: ctx.salonId, depositId: input.depositId }),
)
