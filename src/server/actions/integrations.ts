'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import { disconnect, issueFeedToken, revokeFeedToken } from '@/server/services/integrations'
import { unsafeDb } from '@/server/db/client'

/**
 * Connecting and disconnecting.
 *
 * A feed token is shown exactly once, at the moment it is minted, because only
 * its hash is stored. That is deliberate — a URL that can be re-read from a
 * settings page forever is a credential nobody ever rotates.
 */

const cuid = z.string().min(1).max(64)

export const issueFeedTokenAction = withAuthz(
  {
    action: 'integration.manage',
    schema: z.object({ stylistProfileId: cuid }),
    auditAs: (input) => ({ entityType: 'StylistProfile', entityId: input.stylistProfileId }),
  },
  async (input, ctx) => {
    const stylist = await unsafeDb.stylistProfile.findFirst({
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
