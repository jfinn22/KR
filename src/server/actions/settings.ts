'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz } from './guard'
import { saveJoinCode, saveSchedulingSettings } from '@/server/services/settings'
import { saveAccent } from '@/server/services/branding'

/**
 * How the salon itself is configured.
 *
 * Everything here changes the behaviour of screens other people are already
 * looking at — the diary, the phase editor, every button in the product — so
 * it is manager-and-above and every write is audited.
 */

export const saveSchedulingSettingsAction = withAuthz(
  {
    action: 'settings.manage',
    schema: z.object({
      interleaveEnabled: z.boolean(),
      // Below about a quarter of an hour there is nothing worth selling: the
      // handover costs more than the gap returns.
      minInterleaveMin: z.number().int().min(10).max(120),
      maxConcurrentClients: z.number().int().min(1).max(6),
    }),
    auditAs: () => ({ entityType: 'SalonSettings' }),
  },
  async (input, ctx) => {
    await saveSchedulingSettings(ctx.salonId, input)
    revalidatePath(`/s/${ctx.salonSlug}/admin/settings`)
    revalidatePath(`/s/${ctx.salonSlug}/admin/services`)
    revalidatePath(`/s/${ctx.salonSlug}/desk/calendar`)
    return { saved: true }
  },
)

/**
 * Set or clear the salon's accent colour.
 *
 * `saveAccent` refuses a colour that cannot carry white text or hold a
 * readable wash, and the refusal names the pair that failed — so this action
 * surfaces a DomainError rather than quietly storing something unreadable.
 */
export const saveAccentAction = withAuthz(
  {
    action: 'settings.manage',
    feature: 'BRANDED_EXPERIENCE',
    schema: z.object({ accentHex: z.string().max(9).nullable() }),
    auditAs: (input) => ({ entityType: 'Salon', entityId: input.accentHex ?? 'cleared' }),
  },
  async (input, ctx) => {
    await saveAccent(ctx.salonId, input.accentHex)
    // Branding is on the shell, so every page under it is now stale.
    revalidatePath(`/s/${ctx.salonSlug}`, 'layout')
    return { saved: true }
  },
)

/**
 * Set, rotate or clear the salon's join code.
 *
 * Rotatable because a code read out across a counter all day is a code that
 * leaks — and unlike a password, nobody minds changing it.
 */
export const saveJoinCodeAction = withAuthz(
  {
    action: 'settings.manage',
    schema: z.object({ joinCode: z.string().max(40).nullable() }),
    auditAs: () => ({ entityType: 'SalonSettings' }),
  },
  async (input, ctx) => {
    await saveJoinCode(ctx.salonId, input.joinCode)
    revalidatePath(`/s/${ctx.salonSlug}/admin/settings`)
    return { saved: true }
  },
)
