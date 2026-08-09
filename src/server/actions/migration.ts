'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { commitStaffImport, previewStaffImport } from '@/server/services/migration/staff'
import { withAuthz, DomainError } from './guard'
import { dbFor } from '@/server/db/tenant-client'
import { commitBatch, createBatch, undoBatch } from '@/server/services/migration/batch'
import { rememberOptions, sourceTextOf, storeSource } from '@/server/services/migration/review'
import { parseImport } from '@/domain/migration/parse'

/**
 * Bringing a salon's history across.
 *
 * Owner and manager only. An import can create thousands of client records,
 * touch consent state and write appointment history — it is not a front-desk
 * operation. The undo sits behind the same permission rather than a stricter
 * one, because an owner who cannot reverse their own mistake will not press
 * the button in the first place.
 */

const cuid = z.string().min(1).max(64)

/**
 * The largest file this will take in one go.
 *
 * Well inside the server-action body limit, and well above ten years of a busy
 * salon. A file bigger than this is almost always the wrong export — an image
 * folder, or a database dump — and saying so beats a timeout.
 */
const MAX_TEXT_CHARS = 8 * 1024 * 1024

const dateOrder = z.enum(['DMY', 'MDY', 'ISO'])

/**
 * Whose import this is.
 *
 * `migration.import` is owner-and-manager only, so a system principal cannot
 * reach these actions at all — but the union covers it and an import with no
 * name on it is not an audit record.
 */
function actorOf(ctx: { principal: { kind: string; userId?: string } }): string {
  return ctx.principal.kind === 'system' ? 'system' : (ctx.principal.userId ?? 'system')
}

export const startImportAction = withAuthz(
  {
    action: 'migration.import',
    schema: z.object({
      locationId: cuid,
      /*
       * Asked, never inferred from the file. A multi-site salon is the one most
       * likely to be switching platforms, and a silent wrong guess puts a
       * client's history at the wrong branch.
       */
      sourcePlatform: z.enum(['GENERIC', 'VAGARO', 'SQUARE', 'FRESHA', 'BOOKSY']),
      filename: z.string().min(1).max(255),
      text: z.string().min(1).max(MAX_TEXT_CHARS),
    }),
    auditAs: (input, result) => ({
      entityType: 'ImportBatch',
      entityId: (result as { batchId: string }).batchId,
    }),
  },
  async (input, ctx) => {
    const location = await dbFor(ctx.salonId).location.findFirst({
      where: { id: input.locationId, salonId: ctx.salonId },
      select: { id: true },
    })
    if (!location) throw new DomainError('NOT_FOUND', 'That location is not one of yours.')

    const batch = await createBatch(ctx.salonId, {
      locationId: input.locationId,
      filename: input.filename,
      sourcePlatform: input.sourcePlatform,
      // Filled in below. The row exists first so the object key can be keyed on
      // it, and so a failed upload leaves a visible batch rather than nothing.
      sourceAssetKey: null,
      createdByUserId: actorOf(ctx),
    })

    const key = await storeSource(ctx.salonId, batch.id, input.text)
    await dbFor(ctx.salonId).importBatch.update({
      where: { id: batch.id },
      data: { sourceAssetKey: key, status: 'REVIEWING' },
    })

    revalidatePath(`/s/${ctx.salonSlug}/admin/imports`)
    return { batchId: batch.id }
  },
)

/**
 * Save the answers the file could not settle, without running anything.
 *
 * Separate from committing on purpose: an owner who has to answer the date
 * question should be able to see the dates redrawn before they commit to four
 * thousand rows of history.
 */
export const reviewImportAction = withAuthz(
  {
    action: 'migration.import',
    schema: z.object({
      batchId: cuid,
      dateOrder: dateOrder.optional(),
      defaultCallingCode: z.string().max(6).nullable().optional(),
    }),
  },
  async (input, ctx) => {
    await rememberOptions(ctx.salonId, input.batchId, {
      dateOrder: input.dateOrder,
      defaultCallingCode: input.defaultCallingCode ?? null,
    })
    revalidatePath(`/s/${ctx.salonSlug}/admin/imports/${input.batchId}`)
    return { saved: true }
  },
)

export const commitImportAction = withAuthz(
  {
    action: 'migration.import',
    schema: z.object({
      batchId: cuid,
      dateOrder: dateOrder.optional(),
      defaultCallingCode: z.string().max(6).nullable().optional(),
      /** File's name -> our id. An entry mapped to null is imported unmapped. */
      serviceMap: z.record(z.string(), z.string().nullable()),
      stylistMap: z.record(z.string(), z.string().nullable()),
    }),
    auditAs: (input) => ({ entityType: 'ImportBatch', entityId: input.batchId }),
  },
  async (input, ctx) => {
    const batch = await dbFor(ctx.salonId).importBatch.findFirst({
      where: { id: input.batchId, salonId: ctx.salonId },
      select: { id: true, sourceAssetKey: true, sourcePlatform: true },
    })
    if (!batch) throw new DomainError('NOT_FOUND', 'That import is not here.')

    /*
     * The maps come from the browser, and their values are written straight
     * onto `AppointmentService.serviceId` and `Appointment.primaryStylistId`.
     * Neither foreign key carries a salon, so an id belonging to another salon
     * would be accepted by the database and would put this salon's imported
     * history against somebody else's stylist — visible to them, and counted in
     * their figures. Checked here, once, against what this salon actually has.
     */
    await assertOurs(ctx.salonId, input.serviceMap, input.stylistMap)

    const text = await sourceTextOf(batch.sourceAssetKey)
    const parsed = parseImport(text, {
      platform: batch.sourcePlatform,
      dateOrder: input.dateOrder,
      defaultCallingCode: input.defaultCallingCode ?? null,
    })

    /*
     * The one question that cannot be waved through.
     *
     * Every date in a file of 03/04, 05/06, 07/08 is a coin flip, and getting
     * it wrong moves a salon's entire history by up to eleven months. Refusing
     * here rather than on the screen alone, because the screen is not the only
     * way this action can be called.
     */
    if (parsed.dateOrderAmbiguous) {
      throw new DomainError(
        'INVALID_INPUT',
        'Tell us whether the dates in this file are day-first or month-first before we import it.',
      )
    }

    await rememberOptions(ctx.salonId, input.batchId, {
      dateOrder: input.dateOrder,
      defaultCallingCode: input.defaultCallingCode ?? null,
    })

    const counts = await commitBatch(ctx.salonId, input.batchId, parsed.rows, {
      serviceMap: input.serviceMap,
      stylistMap: input.stylistMap,
    })

    revalidatePath(`/s/${ctx.salonSlug}/admin/imports`)
    revalidatePath(`/s/${ctx.salonSlug}/admin/imports/${input.batchId}`)
    revalidatePath(`/s/${ctx.salonSlug}/desk/clients`)
    return counts
  },
)

export const undoImportAction = withAuthz(
  {
    action: 'migration.import',
    schema: z.object({ batchId: cuid }),
    auditAs: (input) => ({ entityType: 'ImportBatch', entityId: input.batchId }),
  },
  async (input, ctx) => {
    const result = await undoBatch(ctx.salonId, input.batchId, actorOf(ctx))
    revalidatePath(`/s/${ctx.salonSlug}/admin/imports`)
    revalidatePath(`/s/${ctx.salonSlug}/admin/imports/${input.batchId}`)
    revalidatePath(`/s/${ctx.salonSlug}/desk/clients`)
    return result
  },
)

/** Refuses any mapped id that is not this salon's. */
async function assertOurs(
  salonId: string,
  serviceMap: Record<string, string | null>,
  stylistMap: Record<string, string | null>,
): Promise<void> {
  const db = dbFor(salonId)
  const serviceIds = [...new Set(Object.values(serviceMap).filter((id): id is string => !!id))]
  const stylistIds = [...new Set(Object.values(stylistMap).filter((id): id is string => !!id))]

  const [services, stylists] = await Promise.all([
    serviceIds.length
      ? db.service.count({ where: { salonId, id: { in: serviceIds } } })
      : Promise.resolve(0),
    stylistIds.length
      ? db.stylistProfile.count({ where: { salonId, id: { in: stylistIds } } })
      : Promise.resolve(0),
  ])

  if (services !== serviceIds.length || stylists !== stylistIds.length) {
    throw new DomainError('INVALID_INPUT', 'One of those choices is not one of yours.')
  }
}

/**
 * Bringing the team across, names and skills only.
 *
 * `previewStaffImport` and `commitStaffImport` were written with the migration
 * track and never got a screen, so the one thing a salon has to do before
 * importing four thousand appointments — have the stylists those appointments
 * belong to — could only be done by hand, one at a time.
 *
 * Preview and commit are two calls on purpose. A stylist wrongly credited with
 * COLOR_CORRECTION is one the solver will happily book a corrective on, so the
 * owner reads what was matched before any of it is written.
 */
export const previewStaffImportAction = withAuthz(
  {
    action: 'migration.import',
    schema: z.object({ text: z.string().min(1).max(1_000_000) }),
  },
  async (input, ctx) => previewStaffImport(ctx.salonId, input.text),
)

export const commitStaffImportAction = withAuthz(
  {
    action: 'migration.import',
    schema: z.object({
      locationId: z.string().min(1).max(64),
      rows: z
        .array(
          z.object({
            line: z.number().int(),
            displayName: z.string().max(160),
            email: z.string().max(200).nullable(),
            title: z.string().max(160).nullable(),
            skills: z.array(z.string().max(40)).max(20),
            unknownSkills: z.array(z.string().max(80)).max(20),
            problems: z.array(z.string().max(200)).max(10),
          }),
        )
        .max(500),
    }),
    auditAs: () => ({ entityType: 'StylistProfile' }),
  },
  async (input, ctx) => {
    const result = await commitStaffImport(ctx.salonId, input.rows, input.locationId)
    revalidatePath(`/s/${ctx.salonSlug}/admin/imports/staff`)
    return result
  },
)
