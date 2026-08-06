import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import type { ServiceChainSpec } from '@/domain/scheduling/chain'
import type { ServiceFactSpec } from '@/domain/consultation/facts'

/**
 * The catalog.
 *
 * One place defines how a stored service becomes the two shapes the domain
 * layer reasons about: a `ServiceChainSpec` for the scheduler and a
 * `ServiceFactSpec` for the rules engine. Duplicating that mapping is how the
 * quote and the calendar quietly start disagreeing about the same service.
 */

const serviceInclude = {
  phases: { orderBy: { sequence: 'asc' } },
  variants: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
} as const

export type CatalogService = Awaited<ReturnType<typeof getService>>

export async function getService(salonId: string, serviceId: string) {
  const service = await unsafeDb.service.findFirst({
    where: { id: serviceId, salonId },
    include: serviceInclude,
  })
  if (!service) throw new DomainError('NOT_FOUND', 'That service no longer exists.')
  return service
}

export async function getServices(salonId: string, serviceIds: readonly string[]) {
  const services = await unsafeDb.service.findMany({
    where: { salonId, id: { in: [...serviceIds] } },
    include: serviceInclude,
  })
  if (services.length === 0) {
    throw new DomainError('INVALID_INPUT', 'No service was selected.')
  }
  // Preserve the order the client chose, not whatever the database returned.
  return serviceIds
    .map((id) => services.find((s) => s.id === id))
    .filter((s): s is (typeof services)[number] => s !== undefined)
}

/** Categories with their bookable services, for the client-facing picker. */
export async function listCatalog(salonId: string, opts: { onlineOnly?: boolean } = {}) {
  return unsafeDb.serviceCategory.findMany({
    where: { salonId, isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      services: {
        where: {
          isActive: true,
          ...(opts.onlineOnly ? { isBookableOnline: true } : {}),
        },
        orderBy: { sortOrder: 'asc' },
        include: serviceInclude,
      },
    },
  })
}

type ServiceRow = Awaited<ReturnType<typeof getService>>

/** The scheduler's view: a phase chain plus the buffers that wrap it. */
export function toChainSpec(
  service: Pick<ServiceRow, 'id' | 'phases' | 'bufferBeforeMin' | 'bufferAfterMin'>,
  defaults: { bufferBeforeMin: number; bufferAfterMin: number } = {
    bufferBeforeMin: 0,
    bufferAfterMin: 10,
  },
): ServiceChainSpec {
  return {
    serviceId: service.id,
    bufferBeforeMin: service.bufferBeforeMin ?? defaults.bufferBeforeMin,
    bufferAfterMin: service.bufferAfterMin ?? defaults.bufferAfterMin,
    phases: service.phases.map((phase) => ({
      kind: phase.kind as ServiceChainSpec['phases'][number]['kind'],
      label: phase.label,
      durationMin: phase.durationMin,
      requiresStylist: phase.requiresStylist,
      requiresResourceType: phase.requiresResourceType,
      isScalable: phase.isScalable,
    })),
  }
}

/** The rules engine's view: what kind of service this is, and how long it runs. */
export function toFactSpec(service: ServiceRow): ServiceFactSpec {
  return {
    serviceId: service.id,
    name: service.name,
    isChemical: service.isChemical,
    isLightening: service.isLightening,
    containsDye: service.containsDye,
    isExtensionInstall: service.isExtensionInstall,
    baseComplexity: service.baseComplexity,
    basePriceCents: service.basePriceCents,
    requiredSkillCode: service.requiredSkillCode,
    requiredSkillLevel: service.requiredSkillLevel,
    phases: service.phases.map((phase) => ({
      kind: phase.kind as ServiceFactSpec['phases'][number]['kind'],
      label: phase.label,
      durationMin: phase.durationMin,
      isScalable: phase.isScalable,
    })),
  }
}

/**
 * Who could actually perform this.
 *
 * Enabled for every requested service AND signed off to the required level.
 * A stylist who can do two of the three services is not a candidate — the
 * client would arrive to find half their appointment unbookable.
 */
export async function capableStylists(
  salonId: string,
  serviceIds: readonly string[],
  opts: { forNewClient?: boolean } = {},
) {
  const [services, stylists] = await Promise.all([
    unsafeDb.service.findMany({
      where: { salonId, id: { in: [...serviceIds] } },
      select: { id: true, requiredSkillCode: true, requiredSkillLevel: true },
    }),
    unsafeDb.stylistProfile.findMany({
      where: {
        salonId,
        isActive: true,
        ...(opts.forNewClient ? { acceptsNewClients: true } : {}),
      },
      include: {
        skills: { select: { skillCode: true, level: true } },
        services: {
          where: { serviceId: { in: [...serviceIds] } },
          select: { serviceId: true, isEnabled: true },
        },
      },
    }),
  ])

  return stylists.filter((stylist) => {
    const enabled = new Set(stylist.services.filter((s) => s.isEnabled).map((s) => s.serviceId))
    if (!serviceIds.every((id) => enabled.has(id))) return false

    const levels = new Map(stylist.skills.map((s) => [s.skillCode, s.level]))
    return services.every(
      (service) =>
        !service.requiredSkillCode ||
        (levels.get(service.requiredSkillCode) ?? 0) >= (service.requiredSkillLevel ?? 0),
    )
  })
}

/** The highest skill bar across a set of services, for the availability query. */
export async function requiredSkillFor(
  salonId: string,
  serviceIds: readonly string[],
): Promise<{ code: string; level: number } | null> {
  const services = await unsafeDb.service.findMany({
    where: { salonId, id: { in: [...serviceIds] }, requiredSkillCode: { not: null } },
    select: { requiredSkillCode: true, requiredSkillLevel: true },
    orderBy: { requiredSkillLevel: 'desc' },
  })
  const top = services[0]
  return top?.requiredSkillCode
    ? { code: top.requiredSkillCode, level: top.requiredSkillLevel ?? 1 }
    : null
}

// --- Admin writes -----------------------------------------------------------

export interface PhaseInput {
  kind: 'ACTIVE' | 'PROCESSING' | 'RINSE' | 'CONSULT'
  label: string
  durationMin: number
  requiresStylist: boolean
  requiresResourceType: 'CHAIR' | 'BASIN' | 'PROCESSING_SEAT' | 'ROOM' | 'DRYER' | null
  isScalable: boolean
}

/**
 * Replace a service's phase chain.
 *
 * Deletes and recreates rather than diffing: the chain is short, ordered, and
 * meaningless except as a whole, and a partial update that leaves a stale
 * sequence number would corrupt every future estimate.
 */
export async function replacePhases(
  salonId: string,
  serviceId: string,
  phases: readonly PhaseInput[],
): Promise<void> {
  if (phases.length === 0) {
    throw new DomainError('INVALID_INPUT', 'A service needs at least one phase.')
  }
  if (phases.some((p) => p.durationMin <= 0)) {
    throw new DomainError('INVALID_INPUT', 'Every phase needs a duration.')
  }

  await unsafeDb.$transaction(async (tx) => {
    const service = await tx.service.findFirst({
      where: { id: serviceId, salonId },
      select: { id: true },
    })
    if (!service) throw new DomainError('NOT_FOUND', 'That service no longer exists.')

    await tx.servicePhase.deleteMany({ where: { serviceId } })
    await tx.servicePhase.createMany({
      data: phases.map((phase, sequence) => ({
        salonId,
        serviceId,
        sequence,
        kind: phase.kind,
        label: phase.label,
        durationMin: phase.durationMin,
        requiresStylist: phase.requiresStylist,
        requiresResourceType: phase.requiresResourceType,
        isScalable: phase.isScalable,
      })),
    })
  })
}

export interface ServiceInput {
  name: string
  slug: string
  categoryId: string
  description?: string | null
  basePriceCents: number
  baseComplexity: number
  isChemical: boolean
  isLightening: boolean
  containsDye: boolean
  isExtensionInstall: boolean
  requiresConsultation: boolean
  requiresPatchTest: boolean
  requiredSkillCode?: string | null
  requiredSkillLevel?: number | null
  bufferBeforeMin?: number | null
  bufferAfterMin?: number | null
  isBookableOnline: boolean
  isActive: boolean
}

export async function upsertService(
  salonId: string,
  serviceId: string | null,
  input: ServiceInput,
): Promise<string> {
  if (serviceId) {
    const existing = await unsafeDb.service.findFirst({
      where: { id: serviceId, salonId },
      select: { id: true },
    })
    if (!existing) throw new DomainError('NOT_FOUND', 'That service no longer exists.')

    await unsafeDb.service.update({ where: { id: serviceId }, data: input })
    return serviceId
  }

  /*
   * The web address has to be unique within the salon, and until the editor
   * existed nothing could ever hit that constraint — so a collision surfaced as
   * whatever a raw database error maps to. Now that a salon can actually add a
   * service, "Scalp treatment" when there is already a scalp treatment is an
   * ordinary Tuesday, and it should say which field to change.
   */
  const clash = await unsafeDb.service.findFirst({
    where: { salonId, slug: input.slug },
    select: { name: true },
  })
  if (clash) {
    throw new DomainError(
      'CONFLICT',
      `${clash.name} already uses that web address. Give this one a different one.`,
    )
  }

  const created = await unsafeDb.service.create({
    data: { ...input, salonId },
    select: { id: true },
  })
  return created.id
}
