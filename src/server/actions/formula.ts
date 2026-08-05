'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import { saveFormula } from '@/server/services/formulas'
import { updateHairProfile } from '@/server/services/hair-prediction'

/**
 * What went on the hair, and what the hair is like.
 *
 * Both behind `formula.write`, and both resolving the appointment or the client
 * so the OWN grant a stylist holds can actually be satisfied — an action with
 * no resource gives the guard nothing to test ownership against, and locks out
 * the only people who would ever use it.
 */

const cuid = z.string().min(1).max(64)
const level = z.number().int().min(1).max(12).nullable()

export const saveFormulaAction = withAuthz(
  {
    action: 'formula.write',
    schema: z.object({
      appointmentId: cuid,
      purpose: z.enum([
        'GLOBAL_COLOR',
        'ROOT_TOUCH_UP',
        'LIGHTENER',
        'TONER',
        'GLOSS',
        'LOWLIGHT',
        'TREATMENT',
        'PERM',
        'RELAXER',
        'SMOOTHING',
      ]),
      developerVolume: z.number().int().min(0).max(60).nullable(),
      ratio: z.string().max(40).nullable(),
      processingTimeMin: z.number().int().min(0).max(300).nullable(),
      applicationNotes: z.string().max(4000).nullable(),
      components: z
        .array(
          z.object({
            productName: z.string().min(1).max(120),
            brand: z.string().max(80).nullable(),
            shadeCode: z.string().max(40).nullable(),
            parts: z.number().min(0).max(20).nullable(),
            grams: z.number().min(0).max(2000).nullable(),
            retailProductId: cuid.nullable(),
          }),
        )
        .min(1)
        .max(12),
    }),
    resource: async (input, ctx) => {
      const appointment = await ctx.db.appointment.findFirst({
        where: { id: input.appointmentId, salonId: ctx.salonId },
        select: { primaryStylistId: true, clientProfileId: true, locationId: true },
      })
      return {
        salonId: ctx.salonId,
        ownerStylistId: appointment?.primaryStylistId ?? null,
        clientProfileId: appointment?.clientProfileId ?? null,
        locationId: appointment?.locationId ?? null,
      }
    },
    auditAs: (input) => ({ entityType: 'Appointment', entityId: input.appointmentId }),
  },
  async (input, ctx) => {
    const appointment = await ctx.db.appointment.findFirst({
      where: { id: input.appointmentId, salonId: ctx.salonId },
      select: { primaryStylistId: true },
    })
    if (!appointment) throw new DomainError('NOT_FOUND', 'That appointment is not here.')

    const result = await saveFormula({
      salonId: ctx.salonId,
      appointmentId: input.appointmentId,
      /*
       * Attributed to whoever is doing the hair, not to whoever typed it. The
       * front desk writing up a formula on the stylist's behalf is ordinary,
       * and crediting the desk would put it in the wrong person's record.
       */
      stylistProfileId: appointment.primaryStylistId,
      purpose: input.purpose,
      developerVolume: input.developerVolume,
      ratio: input.ratio,
      processingTimeMin: input.processingTimeMin,
      applicationNotes: input.applicationNotes,
      components: input.components,
    })

    revalidatePath(`/s/${ctx.salonSlug}/desk/appointment/${input.appointmentId}`)
    return result
  },
)

export const updateHairProfileAction = withAuthz(
  {
    action: 'formula.write',
    schema: z.object({
      clientProfileId: cuid,
      naturalLevel: level,
      currentLevelRoots: level,
      greyPercent: z.number().int().min(0).max(100).nullable(),
      washesPerWeek: z.number().int().min(0).max(21).nullable(),
      heatStylingPerWeek: z.number().int().min(0).max(21).nullable(),
      swimsChlorinatedWeekly: z.boolean(),
      usesPurpleShampoo: z.boolean(),
      hardWater: z.boolean(),
      /*
       * Bounded to what hair does. Somebody typing 12 means inches, or a typo,
       * and either way a prediction built on it would put roots at four days.
       */
      growthCmPerMonth: z.number().min(0.3).max(3).nullable(),
    }),
    resource: (input, ctx) => ({
      salonId: ctx.salonId,
      clientProfileId: input.clientProfileId,
    }),
    auditAs: (input) => ({ entityType: 'ClientProfile', entityId: input.clientProfileId }),
  },
  async (input, ctx) => {
    const { clientProfileId, ...fields } = input
    await updateHairProfile(ctx.salonId, clientProfileId, fields)

    revalidatePath(`/s/${ctx.salonSlug}/desk/clients/${clientProfileId}`)
    return { saved: true }
  },
)
