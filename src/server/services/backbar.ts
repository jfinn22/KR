import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import { costMix, costPerGramMillicents, margin, type MixLine } from '@/domain/commerce/backbar'

/**
 * What went in the bowl, and what it cost.
 *
 * `ProductUsage` has been in the schema since the beginning with grams, waste
 * grams and a cost in cents, and nothing in the application has ever written or
 * read one. This is the door.
 *
 * The recording happens from the formula, not from a separate stock screen.
 * Anything that asks a stylist to type the same mix twice gets typed once, and
 * the second copy is the one with the money in it.
 */

export interface UsageInput {
  salonId: string
  appointmentId: string
  formulaId: string | null
  /** Grams of the anchor — the colour, as the stylist said it. */
  anchorGrams: number
  /** What was left in the bowl. The only number a salon can act on. */
  wasteGrams: number
}

/**
 * Record what the formula on this appointment cost.
 *
 * Reads the formula's own components rather than taking a second list, so the
 * mix in the client's record and the mix in the cost figure cannot disagree.
 * Replaces any previous record for the appointment: a stylist correcting "60g"
 * to "90g" is fixing a mistake, not logging a second bowl.
 */
export async function recordUsage(input: UsageInput): Promise<{ totalCents: number }> {
  const db = dbFor(input.salonId)

  const appointment = await db.appointment.findFirst({
    where: { id: input.appointmentId, salonId: input.salonId },
    select: { id: true },
  })
  if (!appointment) throw new DomainError('NOT_FOUND', 'That appointment is not here.')

  const formula = input.formulaId
    ? await db.formula.findFirst({
        where: { id: input.formulaId, salonId: input.salonId },
        select: {
          id: true,
          components: {
            orderBy: { sequence: 'asc' },
            select: {
              productName: true,
              brand: true,
              parts: true,
              grams: true,
              retailProductId: true,
            },
          },
        },
      })
    : null

  if (!formula || formula.components.length === 0) {
    throw new DomainError(
      'INVALID_INPUT',
      'Write the formula down first — the cost comes from what is in it.',
    )
  }

  const productIds = formula.components.flatMap((c) =>
    c.retailProductId ? [c.retailProductId] : [],
  )
  const products = productIds.length
    ? await db.retailProduct.findMany({
        where: { salonId: input.salonId, id: { in: productIds } },
        select: { id: true, costCents: true, backbarGramsPerUnit: true },
      })
    : []
  const byId = new Map(products.map((product) => [product.id, product]))

  const lines: MixLine[] = formula.components.map((component) => {
    const product = component.retailProductId ? byId.get(component.retailProductId) : undefined
    return {
      productName:
        [component.brand, component.productName].filter(Boolean).join(' ') || 'Unnamed product',
      parts: component.parts === null ? null : Number(component.parts),
      grams: component.grams === null ? null : Number(component.grams),
      costPerGramMillicents: product
        ? costPerGramMillicents(product.costCents, product.backbarGramsPerUnit)
        : null,
    }
  })

  const costed = costMix(lines, input.anchorGrams, input.wasteGrams)

  await db.$transaction(async (tx) => {
    // One record per appointment. A stylist correcting 60g to 90g is fixing a
    // mistake, not logging a second bowl.
    await tx.productUsage.deleteMany({
      where: { salonId: input.salonId, appointmentId: input.appointmentId },
    })

    for (const [index, costedLine] of costed.lines.entries()) {
      await tx.productUsage.create({
        data: {
          salonId: input.salonId,
          appointmentId: input.appointmentId,
          productId: formula.components[index]?.retailProductId ?? null,
          productName: costedLine.productName,
          grams: costedLine.grams,
          wasteGrams: costedLine.wasteGrams,
          costCents: costedLine.costCents,
        },
      })
    }
  })

  return { totalCents: costed.totalCents }
}

export interface ServiceCost {
  lines: { productName: string; grams: number; wasteGrams: number; costCents: number }[]
  totalCents: number
  wasteCents: number
  /** Null when nothing has been charged yet — a margin on no price is not one. */
  margin: ReturnType<typeof margin> | null
  /** True when a product in the mix has no costed tube size behind it. */
  incomplete: boolean
}

export async function costOfService(
  salonId: string,
  appointmentId: string,
): Promise<ServiceCost | null> {
  const db = dbFor(salonId)

  const [usage, appointment] = await Promise.all([
    db.productUsage.findMany({
      where: { salonId, appointmentId },
      orderBy: { recordedAt: 'asc' },
      select: { productName: true, grams: true, wasteGrams: true, costCents: true },
    }),
    db.appointment.findFirst({
      where: { id: appointmentId, salonId },
      select: { actualTotalCents: true, estimatedTotalCents: true },
    }),
  ])
  if (usage.length === 0) return null

  const lines = usage.map((row) => ({
    productName: row.productName ?? 'Unnamed product',
    grams: Number(row.grams),
    wasteGrams: Number(row.wasteGrams),
    costCents: row.costCents,
  }))

  const totalCents = lines.reduce((total, line) => total + line.costCents, 0)
  const mixed = lines.reduce((total, line) => total + line.grams, 0)
  const wasted = lines.reduce((total, line) => total + line.wasteGrams, 0)
  const wasteCents = mixed > 0 ? Math.round((totalCents * wasted) / mixed) : 0

  const priceCents = appointment?.actualTotalCents ?? appointment?.estimatedTotalCents ?? 0

  return {
    lines,
    totalCents,
    wasteCents,
    margin: priceCents > 0 ? margin(priceCents, totalCents) : null,
    /*
     * Said out loud rather than hidden. A zero-cost line is a product the salon
     * has not told us the tube size of, and a margin quietly computed as if it
     * were free is the number an owner would price against.
     */
    incomplete: lines.some((line) => line.costCents === 0 && line.grams > 0),
  }
}

/**
 * What colour is costing the salon, over a period.
 *
 * Waste is reported next to spend rather than folded into it, because it is the
 * only half anybody can do something about this week.
 */
export async function backbarSummary(
  salonId: string,
  range: { from: Date; to: Date },
): Promise<{ spentCents: number; wasteCents: number; appointments: number }> {
  const db = dbFor(salonId)

  const rows = await db.productUsage.findMany({
    where: { salonId, recordedAt: { gte: range.from, lt: range.to } },
    select: { appointmentId: true, grams: true, wasteGrams: true, costCents: true },
  })

  let spentCents = 0
  let wasteCents = 0
  const appointments = new Set<string>()

  for (const row of rows) {
    const grams = Number(row.grams)
    const waste = Number(row.wasteGrams)
    spentCents += row.costCents
    wasteCents += grams > 0 ? Math.round((row.costCents * waste) / grams) : 0
    appointments.add(row.appointmentId)
  }

  return { spentCents, wasteCents, appointments: appointments.size }
}
