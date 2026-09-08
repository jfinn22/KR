import { describe, expect, it } from 'vitest'
import {
  costMix,
  costPerGramMillicents,
  gramsFromParts,
  margin,
  type MixLine,
} from '@/domain/commerce/backbar'

/**
 * What the colour actually cost.
 *
 * A salon knows what it charges for a balayage and almost never knows what one
 * costs to deliver. The gap is the developer, the second bowl, and the third of
 * a tube that went down the sink.
 */

const line = (over: Partial<MixLine> = {}): MixLine => ({
  productName: 'Colour',
  parts: null,
  grams: null,
  costPerGramMillicents: null,
  ...over,
})

describe('parts into grams', () => {
  it('anchors on the colour, not the total', () => {
    /*
     * "Sixty grams, one to one and a half" means sixty grams OF COLOUR. Reading
     * it as sixty grams of mixture understates every bowl by the developer,
     * which is the larger half of it.
     */
    const mix = [
      line({ productName: 'Colour', parts: 1 }),
      line({ productName: 'Developer', parts: 1.5 }),
    ]
    expect(gramsFromParts(mix, 60)).toEqual([60, 90])
  })

  it('lets a weighed line stand rather than recomputing it', () => {
    // If somebody put it on the scales, the scales win.
    const mix = [line({ parts: 1 }), line({ productName: 'Bond', grams: 5 })]
    expect(gramsFromParts(mix, 60)).toEqual([60, 5])
  })

  it('handles a ratio written the other way up', () => {
    const mix = [line({ parts: 2 }), line({ parts: 1 })]
    expect(gramsFromParts(mix, 60)).toEqual([60, 30])
  })

  it('is not upset by an empty mix', () => {
    expect(gramsFromParts([], 60)).toEqual([])
  })
})

describe('costing the bowl', () => {
  const mix = [
    line({ productName: 'Colour', parts: 1, costPerGramMillicents: 40_000 }), // 40c/g
    line({ productName: 'Developer', parts: 1.5, costPerGramMillicents: 4_000 }), // 4c/g
  ]

  it('adds it up', () => {
    // 60g at 40c = 2400c, 90g at 4c = 360c.
    const costed = costMix(mix, 60)
    expect(costed.totalCents).toBe(2_760)
    expect(costed.lines.map((l) => l.grams)).toEqual([60, 90])
  })

  it('keeps waste separate, because it is the only bit anyone can change', () => {
    /*
     * "That mix cost £27.60" tells an owner nothing. "£18.40 used, £9.20 left
     * in the bowl" tells them to mix less.
     */
    const costed = costMix(mix, 60, 50)
    expect(costed.wasteCents).toBeGreaterThan(0)
    expect(costed.usedCents + costed.wasteCents).toBe(costed.totalCents)
    // A third of 150g thrown away is a third of the money.
    expect(costed.wasteCents).toBe(920)
  })

  it('shares waste across the mixture, not one component of it', () => {
    // What is left in a bowl is mixed colour, not neat developer.
    const costed = costMix(mix, 60, 75)
    expect(costed.lines[0]?.wasteGrams).toBe(30)
    expect(costed.lines[1]?.wasteGrams).toBe(45)
  })

  it('does not let somebody waste more than they mixed', () => {
    const costed = costMix(mix, 60, 9_999)
    expect(costed.wasteCents).toBe(costed.totalCents)
    expect(costed.usedCents).toBe(0)
  })

  it('costs an unpriced line at nothing rather than refusing the whole mix', () => {
    // A salon that has not costed its developer should still see what the
    // colour cost, with the gap visible rather than the screen empty.
    const costed = costMix(
      [line({ parts: 1, costPerGramMillicents: 40_000 }), line({ parts: 1 })],
      60,
    )
    expect(costed.totalCents).toBe(2_400)
  })
})

describe('cost per gram', () => {
  it('divides the tube', () => {
    // £12.00 for a 60g tube is 20c a gram.
    expect(costPerGramMillicents(1_200, 60)).toBe(20_000)
  })

  it('says nothing rather than zero when the size is unknown', () => {
    /*
     * A backbar cost of zero reports every colour service as pure profit, and
     * an owner acts on a margin they believe. No answer beats a wrong one.
     */
    expect(costPerGramMillicents(1_200, null)).toBeNull()
    expect(costPerGramMillicents(1_200, 0)).toBeNull()
  })
})

describe('what was left after the product', () => {
  it('is price minus cost, and nothing cleverer', () => {
    expect(margin(9_000, 2_760)).toEqual({
      priceCents: 9_000,
      costCents: 2_760,
      marginCents: 6_240,
      marginPct: 6_240 / 9_000,
    })
  })

  it('reports a loss as a loss', () => {
    // A correction that ate four tubes should say so.
    expect(margin(4_000, 6_000).marginCents).toBe(-2_000)
  })

  it('has no percentage of nothing', () => {
    expect(margin(0, 500).marginPct).toBeNull()
  })
})
