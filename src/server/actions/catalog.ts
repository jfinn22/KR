'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz } from './guard'
import { replacePhases, upsertService } from '@/server/services/catalog'
import { invalidateAvailabilityCache } from '@/server/services/scheduling/loader'

/**
 * Catalog administration.
 *
 * Editing a service changes every future quote, which is exactly why approved
 * plans freeze their phase chain at approval — a salon adjusting balayage next
 * month must not reshape an appointment somebody already agreed to. That
 * guarantee lives in the plan; this side is free to be a plain editor.
 */

const cuid = z.string().min(1).max(64)

const phaseSchema = z.object({
  kind: z.enum(['ACTIVE', 'PROCESSING', 'RINSE', 'CONSULT']),
  label: z.string().min(1, 'Give the phase a name.').max(80),
  durationMin: z.number().int().min(5).max(600),
  requiresStylist: z.boolean(),
  requiresResourceType: z.enum(['CHAIR', 'BASIN', 'PROCESSING_SEAT', 'ROOM', 'DRYER']).nullable(),
  isScalable: z.boolean(),
})

export const savePhasesAction = withAuthz(
  {
    action: 'service.manage',
    schema: z.object({
      serviceId: cuid,
      phases: z.array(phaseSchema).min(1, 'A service needs at least one phase.').max(12),
    }),
    auditAs: (input) => ({ entityType: 'Service', entityId: input.serviceId }),
  },
  async (input, ctx) => {
    await replacePhases(ctx.salonId, input.serviceId, input.phases)

    // Availability is solved from the chain, so a cached request is now wrong.
    invalidateAvailabilityCache(ctx.salonId)
    revalidatePath(`/s/${ctx.salonSlug}/admin/services`)
    revalidatePath(`/s/${ctx.salonSlug}/admin/services/${input.serviceId}`)

    return { saved: true }
  },
)

export const saveServiceAction = withAuthz(
  {
    action: 'service.manage',
    schema: z.object({
      serviceId: cuid.nullable(),
      name: z.string().min(1, 'Give the service a name.').max(120),
      slug: z
        .string()
        .min(1)
        .max(80)
        .regex(/^[a-z0-9-]+$/, 'Lower case letters, numbers and hyphens only.'),
      categoryId: cuid,
      description: z.string().max(1000).nullish(),
      basePriceCents: z.number().int().min(0).max(10_000_00),
      baseComplexity: z.number().int().min(0).max(100),
      isChemical: z.boolean(),
      isLightening: z.boolean(),
      containsDye: z.boolean(),
      isExtensionInstall: z.boolean(),
      requiresConsultation: z.boolean(),
      requiresPatchTest: z.boolean(),
      requiredSkillCode: z.string().max(40).nullish(),
      requiredSkillLevel: z.number().int().min(1).max(5).nullish(),
      bufferBeforeMin: z.number().int().min(0).max(120).nullish(),
      bufferAfterMin: z.number().int().min(0).max(120).nullish(),
      isBookableOnline: z.boolean(),
      isActive: z.boolean(),
    }),
    auditAs: (_input, result) => ({
      entityType: 'Service',
      entityId: (result as { serviceId: string }).serviceId,
    }),
  },
  async (input, ctx) => {
    const { serviceId, ...fields } = input

    // Lightening is chemical whatever the boxes say. Letting these disagree
    // would silently switch off the patch-test and staged-lift rules.
    const normalized = {
      ...fields,
      isChemical: fields.isChemical || fields.isLightening || fields.containsDye,
    }

    const savedId = await upsertService(ctx.salonId, serviceId, normalized)

    invalidateAvailabilityCache(ctx.salonId)
    revalidatePath(`/s/${ctx.salonSlug}/admin/services`)

    return { serviceId: savedId }
  },
)
