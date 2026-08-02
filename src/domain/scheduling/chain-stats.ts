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

/** Below this, a gap is not worth handing to another client. */
export const INTERLEAVE_MIN = 20

export interface ChainStats {
  totalMin: number
  stylistMin: number
  /** Contiguous non-blocking runs long enough to be worth offering. */
  interleavableMin: number
}

export function chainStats(phases: readonly PhaseDraft[]): ChainStats {
  let totalMin = 0
  let stylistMin = 0
  let interleavableMin = 0
  let run = 0

  for (const phase of phases) {
    const minutes = Math.max(0, phase.durationMin)
    totalMin += minutes

    if (phase.requiresStylist) {
      stylistMin += minutes
      // A run only counts once it ends — mid-appointment gaps are the ones
      // another client can actually be slotted into.
      if (run >= INTERLEAVE_MIN) interleavableMin += run
      run = 0
    } else {
      run += minutes
    }
  }

  // A trailing free run still counts: the stylist is released before the end.
  if (run >= INTERLEAVE_MIN) interleavableMin += run

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
