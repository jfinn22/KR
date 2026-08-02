import type { PhaseChain, PhaseLink, ResourceType, SchedulingSettings } from './types'

/**
 * Building the shape of an appointment.
 *
 * A service is a sequence of phases, not a block of minutes. The chain is what
 * the solver places, and it is frozen onto an approved plan so a later catalog
 * edit cannot change an appointment somebody already booked.
 */

export interface ServicePhaseSpec {
  kind: 'ACTIVE' | 'PROCESSING' | 'RINSE' | 'CONSULT'
  label: string
  durationMin: number
  requiresStylist: boolean
  requiresResourceType: ResourceType | null
  isScalable: boolean
}

export interface ServiceChainSpec {
  serviceId: string
  phases: readonly ServicePhaseSpec[]
  bufferBeforeMin: number
  bufferAfterMin: number
}

export interface ChainOptions {
  /** Multiplier applied to scalable phases only — hair volume, not chemistry. */
  scalableFactor?: number
  /** Extra minutes distributed across scalable phases, e.g. from a rules-engine delta. */
  extraScalableMin?: number
  settings: SchedulingSettings
}

const round5 = (n: number) => Math.max(0, Math.round(n / 5) * 5)

/**
 * Expand services into one chain.
 *
 * Buffers wrap the whole appointment rather than each service: a client having
 * colour then a cut does not need two clean-down gaps in the middle.
 */
export function buildChain(services: readonly ServiceChainSpec[], opts: ChainOptions): PhaseChain {
  if (services.length === 0) return []

  const factor = opts.scalableFactor ?? 1
  const extra = opts.extraScalableMin ?? 0

  const scalableTotal = services.reduce(
    (sum, s) => sum + s.phases.filter((p) => p.isScalable).reduce((a, p) => a + p.durationMin, 0),
    0,
  )

  const links: PhaseLink[] = []

  const bufferBefore = Math.max(...services.map((s) => s.bufferBeforeMin), 0)
  if (bufferBefore > 0) {
    links.push({
      kind: 'BUFFER_BEFORE',
      label: 'Set-up',
      durationMin: bufferBefore,
      blocksStylist: true,
      blocksResource: false,
      requiresResourceType: null,
      serviceId: null,
    })
  }

  for (const service of services) {
    for (const phase of service.phases) {
      let minutes = phase.durationMin
      if (phase.isScalable && scalableTotal > 0) {
        const share = phase.durationMin / scalableTotal
        minutes = round5(phase.durationMin * factor + extra * share)
      }
      if (minutes <= 0) continue

      links.push({
        // A CONSULT phase occupies the stylist exactly like active work does.
        kind: phase.kind === 'CONSULT' ? 'ACTIVE' : phase.kind,
        label: phase.label,
        durationMin: minutes,
        blocksStylist: phase.requiresStylist,
        blocksResource: phase.requiresResourceType !== null,
        requiresResourceType: phase.requiresResourceType,
        serviceId: service.serviceId,
      })
    }
  }

  const bufferAfter = Math.max(...services.map((s) => s.bufferAfterMin), 0)
  if (bufferAfter > 0) {
    links.push({
      kind: 'BUFFER_AFTER',
      label: 'Clean-down',
      durationMin: bufferAfter,
      blocksStylist: true,
      blocksResource: false,
      requiresResourceType: null,
      serviceId: null,
    })
  }

  return applyInterleavePolicy(links, opts.settings)
}

/**
 * Decide which processing gaps are genuinely usable by another client.
 *
 * A gap the stylist is nominally free for is worthless if it is ten minutes
 * long — nobody can be seen in it, and pretending otherwise drops a client into
 * a hole. So short gaps, and every gap when the salon has not enabled
 * interleaving, are marked as blocking the stylist after all.
 */
export function applyInterleavePolicy(chain: PhaseChain, settings: SchedulingSettings): PhaseChain {
  return chain.map((link) => {
    if (link.kind !== 'PROCESSING' || link.blocksStylist) return link

    const usable = settings.interleaveEnabled && link.durationMin >= settings.minInterleaveMin
    return usable ? link : { ...link, blocksStylist: true }
  })
}

export const chainDuration = (chain: PhaseChain): number =>
  chain.reduce((sum, link) => sum + link.durationMin, 0)

/** Minutes the stylist is actually occupied — what a chair-hours report needs. */
export const chainStylistMinutes = (chain: PhaseChain): number =>
  chain.filter((l) => l.blocksStylist).reduce((sum, l) => sum + l.durationMin, 0)

/** Whether this chain hands a usable gap to someone else. */
export const chainOffersInterleave = (chain: PhaseChain): boolean =>
  chain.some((l) => l.kind === 'PROCESSING' && !l.blocksStylist)

/** Stable identity for caching an availability query. */
export function chainSignature(chain: PhaseChain): string {
  return chain
    .map(
      (l) =>
        `${l.kind}:${l.durationMin}:${l.blocksStylist ? 1 : 0}:${l.requiresResourceType ?? '-'}`,
    )
    .join('|')
}
