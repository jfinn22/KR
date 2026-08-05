/**
 * What the colour actually cost.
 *
 * A salon knows what it charges for a balayage and almost never knows what one
 * costs to deliver. The gap is not the shade — it is the developer, the second
 * bowl somebody mixed because the first was short, and the third of a tube that
 * went down the sink. Those are the numbers that differ between two salons
 * charging the same price and making very different money.
 *
 * Pure, and it deals in grams. A stylist writes a formula in parts — 1:1.5 —
 * and a bowl is weighed in grams, and the conversion between the two is the one
 * place this arithmetic goes wrong.
 */

/** A line of a formula, as the stylist wrote it. */
export interface MixLine {
  /** What it is, for the bill of materials. */
  productName: string
  /** Parts, as written. Null where the stylist weighed it directly. */
  parts: number | null
  /** Grams, where they were measured. Wins over parts when both are given. */
  grams: number | null
  /** Cost of one gram, in hundredths of a cent. */
  costPerGramMillicents: number | null
}

export interface CostedLine extends MixLine {
  /** What was mixed. */
  grams: number
  /** What went down the sink. */
  wasteGrams: number
  costCents: number
}

/**
 * Turn a ratio into grams.
 *
 * A formula of 1:1.5 and a 60-gram bowl of colour is 60g and 90g, not 40g and
 * 60g — the number a stylist says out loud is almost always the colour, not the
 * total. Getting that backwards understates every mix by the developer, which
 * is the larger half.
 */
export function gramsFromParts(lines: readonly MixLine[], anchorGrams: number): number[] {
  if (lines.length === 0) return []

  /*
   * The anchor is the first line with parts, which is the colour: a stylist
   * saying "sixty grams, one to one and a half" means sixty grams of colour.
   */
  const anchor = lines.find((line) => line.parts !== null && line.parts > 0)
  const anchorParts = anchor?.parts ?? 1

  return lines.map((line) => {
    if (line.grams !== null) return round1(line.grams)
    if (line.parts === null) return 0
    return round1((line.parts / anchorParts) * anchorGrams)
  })
}

/**
 * Cost the mix, including what was thrown away.
 *
 * Waste is a separate number rather than folded into the total, because it is
 * the only one a salon can do anything about. A mix that cost £4.10 tells an
 * owner nothing; £3.20 used and 90p in the bowl tells them to buy smaller
 * brushes.
 */
export function costMix(
  lines: readonly MixLine[],
  anchorGrams: number,
  wasteGrams = 0,
): { lines: CostedLine[]; usedCents: number; wasteCents: number; totalCents: number } {
  const grams = gramsFromParts(lines, anchorGrams)
  const mixed = grams.reduce((total, value) => total + value, 0)

  /*
   * Waste is shared across the lines in proportion to what went in, because
   * what is left in a bowl is the mixture, not one component of it.
   */
  const wasteShare = mixed > 0 ? Math.min(wasteGrams, mixed) / mixed : 0

  const costed = lines.map((line, index): CostedLine => {
    const lineGrams = grams[index] ?? 0
    const perGram = line.costPerGramMillicents ?? 0
    return {
      ...line,
      grams: lineGrams,
      wasteGrams: round1(lineGrams * wasteShare),
      costCents: Math.round((lineGrams * perGram) / 1000),
    }
  })

  const totalCents = costed.reduce((total, line) => total + line.costCents, 0)
  const wasteCents = Math.round(totalCents * wasteShare)

  return { lines: costed, usedCents: totalCents - wasteCents, wasteCents, totalCents }
}

/**
 * Cost per gram from what the salon paid for the tube.
 *
 * Null rather than zero where the size is unknown. A backbar cost of zero
 * silently reports every colour service as pure profit, which is a worse
 * answer than no answer — an owner acts on a margin they believe.
 */
export function costPerGramMillicents(
  unitCostCents: number,
  gramsPerUnit: number | null,
): number | null {
  if (gramsPerUnit === null || gramsPerUnit <= 0) return null
  return Math.round((unitCostCents * 1000) / gramsPerUnit)
}

export interface Margin {
  priceCents: number
  costCents: number
  marginCents: number
  /** Null when nothing was charged — a percentage of zero is not a number. */
  marginPct: number | null
}

/**
 * What was left after the product.
 *
 * Product only. Not labour, not rent, not the card fee — a "true cost" that
 * quietly includes a share of the rent is a number nobody can check, and the
 * one thing a stylist can act on at the bowl is how much they mixed.
 */
export function margin(priceCents: number, costCents: number): Margin {
  const marginCents = priceCents - costCents
  return {
    priceCents,
    costCents,
    marginCents,
    marginPct: priceCents === 0 ? null : marginCents / priceCents,
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
