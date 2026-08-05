import { unsafeDb } from '@/server/db/client'
import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import { noteColourApplied } from './hair-prediction'

/**
 * Writing down what went on the hair.
 *
 * `Formula` and `FormulaComponent` have been in the schema from the beginning
 * and are read in three places — the handoff card, the client timeline, the
 * backbar costing — with nothing in the application ever creating one. The seed
 * makes them, which is why every screen that reads them has always looked
 * finished.
 *
 * Two things happen on save, and the second is the point. The formula is
 * recorded, and the client's hair profile is told a colour happened — because
 * the profile's dates are what the history array reads, and the history array
 * is what everything else reasons from. A stylist should not have to write the
 * date down twice, and if they did, one of the two copies would be wrong.
 */

export interface FormulaComponentInput {
  productName: string
  brand?: string | null
  shadeCode?: string | null
  parts?: number | null
  grams?: number | null
  developerVolume?: number | null
  /** Links this line to the salon's stock, which is what makes costing possible. */
  retailProductId?: string | null
  role?: 'BASE' | 'TONE' | 'ADDITIVE' | 'DEVELOPER'
}

export interface SaveFormulaInput {
  salonId: string
  appointmentId: string
  stylistProfileId: string
  purpose: string
  developerVolume?: number | null
  ratio?: string | null
  processingTimeMin?: number | null
  applicationNotes?: string | null
  components: readonly FormulaComponentInput[]
}

export async function saveFormula(input: SaveFormulaInput): Promise<{ formulaId: string }> {
  const db = dbFor(input.salonId)

  const appointment = await db.appointment.findFirst({
    where: { id: input.appointmentId, salonId: input.salonId },
    select: { id: true, clientProfileId: true, startsAt: true },
  })
  if (!appointment) throw new DomainError('NOT_FOUND', 'That appointment is not here.')

  if (input.components.length === 0) {
    throw new DomainError('INVALID_INPUT', 'A formula needs at least one thing in it.')
  }

  /*
   * Products, checked against this salon's own stock.
   *
   * `FormulaComponent.retailProductId` is a bare string with no foreign key at
   * all, so nothing in the database would object to another salon's id — and it
   * is the id the backbar costing then prices against.
   */
  const productIds = [
    ...new Set(input.components.flatMap((c) => (c.retailProductId ? [c.retailProductId] : []))),
  ]
  if (productIds.length > 0) {
    const ours = await unsafeDb.retailProduct.count({
      where: { salonId: input.salonId, id: { in: productIds } },
    })
    if (ours !== productIds.length) {
      throw new DomainError('INVALID_INPUT', 'One of those products is not one of yours.')
    }
  }

  const formula = await unsafeDb.$transaction(async (tx) => {
    /*
     * One formula per appointment. A stylist correcting what they mixed is
     * fixing a record, not adding a second bowl — and `costOfService` reads the
     * appointment's formula, so two would make the cost ambiguous.
     */
    await tx.formula.deleteMany({
      where: { salonId: input.salonId, appointmentId: input.appointmentId, isTemplate: false },
    })

    return tx.formula.create({
      data: {
        salonId: input.salonId,
        clientProfileId: appointment.clientProfileId,
        appointmentId: appointment.id,
        stylistProfileId: input.stylistProfileId,
        purpose: input.purpose as never,
        developerVolume: input.developerVolume ?? null,
        ratio: input.ratio ?? null,
        processingTimeMin: input.processingTimeMin ?? null,
        applicationNotes: input.applicationNotes ?? null,
        /*
         * Dated by the appointment, not by now(). A formula written up at the
         * end of the day, or three days later when somebody remembers, is still
         * a colour that went on at the appointment — and `createdAt` is the
         * clock everything asking "how grown out is this" reads.
         */
        createdAt: appointment.startsAt,
        components: {
          create: input.components.map((component, sequence) => ({
            salonId: input.salonId,
            sequence,
            productName: component.productName,
            brand: component.brand ?? null,
            shadeCode: component.shadeCode ?? null,
            parts: component.parts ?? null,
            grams: component.grams ?? null,
            developerVolume: component.developerVolume ?? null,
            retailProductId: component.retailProductId ?? null,
            role: (component.role ?? 'BASE') as never,
          })),
        },
      },
      select: { id: true },
    })
  })

  /*
   * Tell the hair record a colour happened.
   *
   * Outside the transaction on purpose: a failure here should not lose the
   * formula the stylist just typed. The profile date is a derived convenience
   * and can be rebuilt from the formulas; the formula cannot be rebuilt from
   * anything.
   */
  await noteColourApplied(input.salonId, appointment.clientProfileId, {
    at: appointment.startsAt,
    purpose: input.purpose,
    developerVolume: input.developerVolume ?? null,
  })

  return { formulaId: formula.id }
}

/** The formula on this appointment, for the form to open with. */
export async function formulaFor(salonId: string, appointmentId: string) {
  const db = dbFor(salonId)
  return db.formula.findFirst({
    where: { salonId, appointmentId, isTemplate: false },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      purpose: true,
      developerVolume: true,
      ratio: true,
      processingTimeMin: true,
      applicationNotes: true,
      components: {
        orderBy: { sequence: 'asc' },
        select: {
          productName: true,
          brand: true,
          shadeCode: true,
          parts: true,
          grams: true,
          retailProductId: true,
          role: true,
        },
      },
    },
  })
}
