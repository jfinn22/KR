import { unsafeDb } from '@/server/db/client'
import { invalidateAvailabilityCache } from '@/server/services/scheduling/loader'
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

/** What the settings screen shows and writes. */
export interface SchedulingSettingsView {
  interleaveEnabled: boolean
  minInterleaveMin: number
  maxConcurrentClients: number
}

export async function schedulingSettings(salonId: string): Promise<SchedulingSettingsView> {
  const row = await unsafeDb.salonSettings.findUnique({
    where: { salonId },
    select: {
      interleaveEnabled: true,
      minInterleaveMin: true,
      maxConcurrentClients: true,
    },
  })

  return {
    interleaveEnabled: row?.interleaveEnabled ?? false,
    minInterleaveMin: row?.minInterleaveMin ?? 25,
    maxConcurrentClients: row?.maxConcurrentClients ?? 2,
  }
}

/**
 * Write the scheduling settings, and drop the availability cache.
 *
 * `loadAvailabilityRequest` memoises per salon for 20 seconds keyed on the
 * chain signature. Without the invalidation an owner turns interleaving on,
 * reloads, and sees the old answer — then reports that the setting does not
 * work, which is worse than not having the setting.
 */
export async function saveSchedulingSettings(
  salonId: string,
  input: SchedulingSettingsView,
): Promise<void> {
  await unsafeDb.salonSettings.update({
    where: { salonId },
    data: {
      interleaveEnabled: input.interleaveEnabled,
      minInterleaveMin: input.minInterleaveMin,
      maxConcurrentClients: input.maxConcurrentClients,
    },
  })

  invalidateAvailabilityCache(salonId)
}

export async function joinCodeFor(salonId: string): Promise<string | null> {
  const row = await unsafeDb.salonSettings.findUnique({
    where: { salonId },
    select: { joinCode: true },
  })
  return row?.joinCode ?? null
}

/*
 * Generating a code lives in `src/lib/join-code.ts`, not here.
 *
 * The settings form is a client component and needs it, and this module
 * imports Prisma — so exporting it from here would pull the database client
 * into the browser bundle. `check:boundary` catches a server module reaching
 * into a client one, not this direction, so nothing would have complained.
 */

export async function saveJoinCode(salonId: string, joinCode: string | null): Promise<void> {
  await unsafeDb.salonSettings.update({
    where: { salonId },
    data: { joinCode: joinCode?.trim().toUpperCase() || null },
  })
}
