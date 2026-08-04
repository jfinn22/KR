/**
 * What a phase chain costs and what it frees.
 *
 * Pure arithmetic over a draft chain, shared by the phase editor (client) and
 * the catalog list (server). Lives in the domain rather than beside the editor
 * so both can call it — a server component cannot call a function exported from
 * a `'use client'` module.
 */

export type PhaseKind = 'ACTIVE' | 'PROCESSING' | 'RINSE' | 'CONSULT'
export type ResourceType = 'CHAIR' | 'BASIN' | 'PROCESSING_SEAT' | 'ROOM' | 'DRYER'

export interface PhaseDraft {
  kind: PhaseKind
  label: string
  durationMin: number
  requiresStylist: boolean
  requiresResourceType: ResourceType | null
  isScalable: boolean
}

/**
 * The salon's own interleaving policy.
 *
 * These are `SalonSettings.interleaveEnabled` and `minInterleaveMin`, and they
 * have to be passed in rather than assumed. This module used to carry its own
 * `INTERLEAVE_MIN = 20` while the solver used the salon's setting, default 25 —
 * so the phase editor advertised gaps in gold that `applyInterleavePolicy`
 * then re-blocked at booking time. The editor promised capacity the product
 * would not sell.
 */
export interface InterleaveSettings {
  interleaveEnabled: boolean
  minInterleaveMin: number
}

export interface ChainStats {
  totalMin: number
  stylistMin: number
  /** Contiguous time the solver will genuinely release the stylist for. */
  interleavableMin: number
}

/**
 * Whether the solver will actually leave this phase off the stylist's clock.
 *
 * Mirrors `applyInterleavePolicy` in `chain.ts` exactly: only PROCESSING is
 * gated on the opt-in and the minimum, and a phase that fails the gate is held
 * against the stylist rather than silently dropped.
 */
export function releasesStylist(phase: PhaseDraft, settings: InterleaveSettings): boolean {
  if (phase.requiresStylist) return false
  if (phase.kind !== 'PROCESSING') return true
  return settings.interleaveEnabled && phase.durationMin >= settings.minInterleaveMin
}

export function chainStats(
  phases: readonly PhaseDraft[],
  settings: InterleaveSettings,
): ChainStats {
  let totalMin = 0
  let stylistMin = 0
  let interleavableMin = 0
  let run = 0

  for (const phase of phases) {
    const minutes = Math.max(0, phase.durationMin)
    totalMin += minutes

    if (releasesStylist(phase, settings)) {
      // Adjacent freed phases combine: two that each cleared the gate are one
      // continuous stretch somebody else can be sat in.
      run += minutes
    } else {
      stylistMin += minutes
      interleavableMin += run
      run = 0
    }
  }

  // A trailing free run still counts: the stylist is released before the end.
  interleavableMin += run

  return { totalMin, stylistMin, interleavableMin }
}

export function blankPhase(): PhaseDraft {
  return {
    kind: 'ACTIVE',
    label: '',
    durationMin: 30,
    requiresStylist: true,
    requiresResourceType: 'CHAIR',
    isScalable: true,
  }
}

/**
 * Keep the flags coherent with the kind.
 *
 * Processing that "requires the stylist" is the single most expensive mistake
 * available in the editor — it silently switches off interleaving for every
 * future booking — so changing the kind sets the sane defaults rather than
 * leaving a stale flag behind.
 */
export function applyKindDefaults(phase: PhaseDraft, patch: Partial<PhaseDraft>): PhaseDraft {
  const next = { ...phase, ...patch }
  if (!patch.kind || patch.kind === phase.kind) return next

  if (patch.kind === 'PROCESSING') {
    next.requiresStylist = false
    next.isScalable = false
    next.requiresResourceType = next.requiresResourceType ?? 'PROCESSING_SEAT'
  } else if (patch.kind === 'RINSE') {
    next.requiresStylist = true
    next.requiresResourceType = 'BASIN'
  } else {
    next.requiresStylist = true
  }
  return next
}
