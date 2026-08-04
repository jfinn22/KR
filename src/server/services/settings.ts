import { unsafeDb } from '@/server/db/client'
import type { InterleaveSettings } from '@/domain/scheduling/chain-stats'

/**
 * Salon settings, read where a screen needs them.
 *
 * The fallbacks here deliberately match `loadAvailabilityRequest`'s. A salon
 * row with no settings must behave identically wherever it is read, or the
 * phase editor and the solver disagree again — which is exactly the bug this
 * function exists to close.
 */

export async function interleaveSettings(salonId: string): Promise<InterleaveSettings> {
  const row = await unsafeDb.salonSettings.findUnique({
    where: { salonId },
    select: { interleaveEnabled: true, minInterleaveMin: true },
  })

  return {
    interleaveEnabled: row?.interleaveEnabled ?? false,
    minInterleaveMin: row?.minInterleaveMin ?? 25,
  }
}
