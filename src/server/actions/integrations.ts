'use server'

import { dbFor } from '@/server/db/tenant-client'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import {
  addEndpoint,
  disconnect,
  issueFeedToken,
  removeEndpoint,
  revokeFeedToken,
  type WebhookTopic,
} from '@/server/services/integrations'

/**
 * Connecting and disconnecting.
 *
 * A feed token is shown exactly once, at the moment it is minted, because only
 * its hash is stored. That is deliberate — a URL that can be re-read from a
 * settings page forever is a credential nobody ever rotates.
 */

const cuid = z.string().min(1).max(64)

/*
 * Spelled out as a tuple because `z.enum` needs a non-empty literal tuple and
 * a `readonly WebhookTopic[]` is not one. Kept beside the type so the compiler
 * complains here if the vocabulary grows and this does not.
 */
const WEBHOOK_TOPICS_TUPLE = [
  'appointment.booked',
  'appointment.cancelled',
  'appointment.completed',
  'consultation.submitted',
  'consultation.approved',
  'payment.captured',
] as const satisfies readonly WebhookTopic[]

export const issueFeedTokenAction = withAuthz(
  {
    action: 'integration.manage',
    feature: 'API_ACCESS',
    schema: z.object({ stylistProfileId: cuid }),
    auditAs: (input) => ({ entityType: 'StylistProfile', entityId: input.stylistProfileId }),
  },
  async (input, ctx) => {
    const stylist = await dbFor(ctx.salonId).stylistProfile.findFirst({
      where: { id: input.stylistProfileId, salonId: ctx.salonId },
      select: { id: true },
    })
    if (!stylist) throw new DomainError('NOT_FOUND', 'That stylist is not on this team.')

    const result = await issueFeedToken(ctx.salonId, input.stylistProfileId)
    revalidatePath(`/s/${ctx.salonSlug}/admin/integrations`)

    // The only time the caller ever sees this value.
    return result
  },
)

export const revokeFeedTokenAction = withAuthz(
  {
    action: 'integration.manage',
    schema: z.object({ stylistProfileId: cuid }),
    auditAs: (input) => ({ entityType: 'StylistProfile', entityId: input.stylistProfileId }),
  },
  async (input, ctx) => {
    await revokeFeedToken(ctx.salonId, input.stylistProfileId)
    revalidatePath(`/s/${ctx.salonSlug}/admin/integrations`)
    return { revoked: true }
  },
)

export const disconnectAction = withAuthz(
  {
    action: 'integration.manage',
    schema: z.object({ connectionId: cuid }),
    auditAs: (input) => ({ entityType: 'IntegrationConnection', entityId: input.connectionId }),
  },
  async (input, ctx) => {
    await disconnect(ctx.salonId, input.connectionId)
    revalidatePath(`/s/${ctx.salonSlug}/admin/integrations`)
    return { disconnected: true }
  },
)

/**
 * Register a URL for the salon's own events.
 *
 * Gated on API_ACCESS, which the pricing page has been selling since the plan
 * tiers landed while nothing behind it worked. The secret comes back exactly
 * once, for the same reason a feed token does — except here it is stored in the
 * clear rather than hashed, because a signature the receiver can verify
 * requires both sides to hold the same value.
 */
export const addEndpointAction = withAuthz(
  {
    action: 'integration.manage',
    feature: 'API_ACCESS',
    schema: z.object({
      url: z.string().min(1).max(500),
      topics: z.array(z.enum(WEBHOOK_TOPICS_TUPLE)).max(20),
    }),
    auditAs: () => ({ entityType: 'WebhookEndpoint', entityId: 'new' }),
  },
  async (input, ctx) => {
    const result = await addEndpoint({
      salonId: ctx.salonId,
      url: input.url,
      topics: input.topics,
    })
    revalidatePath(`/s/${ctx.salonSlug}/admin/integrations`)
    return result
  },
)

export const removeEndpointAction = withAuthz(
  {
    action: 'integration.manage',
    schema: z.object({ endpointId: cuid }),
    auditAs: (input) => ({ entityType: 'WebhookEndpoint', entityId: input.endpointId }),
  },
  async (input, ctx) => {
    await removeEndpoint(ctx.salonId, input.endpointId)
    revalidatePath(`/s/${ctx.salonSlug}/admin/integrations`)
    return { removed: true }
  },
)
