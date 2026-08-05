import { describe, expect, it } from 'vitest'
import { colourKindOf, predictFade, type FadeInputs } from '@/domain/hair/fade'

/**
 * When the colour will go, and when the roots will show.
 *
 * The tests that matter most here are the ones where it declines to answer. A
 * confident wrong date is worse than an empty space: an empty space gets asked
 * about, and a date gets believed.
 */

const COLOURED = new Date('2026-05-01T10:00:00Z')
const NOW = new Date('2026-05-15T10:00:00Z')

const base = (over: Partial<FadeInputs> = {}): FadeInputs => ({
  colouredAt: COLOURED,
  kind: 'PERMANENT',
  naturalLevel: 6,
  currentLevel: 7,
  greyPercent: 0,
  washesPerWeek: 3,
  heatStylingPerWeek: 3,
  swimsChlorinatedWeekly: false,
  usesPurpleShampoo: false,
  hardWater: false,
  growthCmPerMonth: 1.25,
  ...over,
})

/** Whole weeks between the colour and a predicted date. */
const weeksFrom = (date: Date | null): number | null =>
  date === null ? null : Math.round((date.getTime() - COLOURED.getTime()) / (7 * 86_400_000))

describe('when it will not answer', () => {
  it('says nothing at all without a date to work from', () => {
    /*
     * The one input with no average to fall back on. Measuring from "now"
     * would silently mean "however long ago somebody happened to open this
     * screen", which is not a fact about the hair.
     */
    const p = predictFade(base({ colouredAt: null }), NOW)
    expect(p.dueAt).toBeNull()
    expect(p.confidence).toBe('NONE')
    expect(p.missing).toContain('when their colour was last done')
  })

  it('says nothing without knowing what kind of colour it was', () => {
    // The gap between a toner and a tint is the biggest term in the model.
    const p = predictFade(base({ kind: null }), NOW)
    expect(p.dueAt).toBeNull()
    expect(p.missing).toContain('what kind of colour it was')
  })

  it('will not project forward from a colour two years old', () => {
    /*
     * That is a fact about history, not a basis for a prediction — the client
     * has been somewhere else, or has stopped colouring. Projecting from it
     * puts a due date in the past and dresses it up as advice.
     */
    const p = predictFade(base({ colouredAt: new Date('2024-05-01T10:00:00Z') }), NOW)
    expect(p.confidence).toBe('NONE')
  })

  it('names every gap rather than quietly using an average', () => {
    const p = predictFade(
      base({ naturalLevel: null, currentLevel: null, washesPerWeek: null }),
      NOW,
    )
    expect(p.missing).toEqual([
      'their natural level',
      'the level they are wearing',
      'how often they wash it',
    ])
    // Still answers on tone — it just says the answer is rough.
    expect(p.toneFadesAt).not.toBeNull()
    expect(p.rootsShowAt).toBeNull()
    expect(p.confidence).toBe('ROUGH')
  })
})

describe('the two clocks', () => {
  it('has a toner gone long before a tint', () => {
    expect(weeksFrom(predictFade(base({ kind: 'TONER' }), NOW).toneFadesAt)).toBe(4)
    expect(weeksFrom(predictFade(base({ kind: 'PERMANENT' }), NOW).toneFadesAt)).toBe(8)
  })

  it('shows roots sooner the more contrast there is', () => {
    // Level 4 under level 9 announces itself; level 6 under 7 does not.
    const high = predictFade(base({ naturalLevel: 4, currentLevel: 9 }), NOW)
    const low = predictFade(base({ naturalLevel: 6, currentLevel: 7 }), NOW)
    expect(weeksFrom(high.rootsShowAt)!).toBeLessThan(weeksFrom(low.rootsShowAt)!)
  })

  it('lets grey overrule the contrast rule entirely', () => {
    /*
     * Grey at the parting is not a shade difference, it is a different texture
     * catching the light — it shows sooner than any level arithmetic predicts.
     */
    const grey = predictFade(base({ naturalLevel: 6, currentLevel: 6, greyPercent: 60 }), NOW)
    const notGrey = predictFade(base({ naturalLevel: 6, currentLevel: 6, greyPercent: 0 }), NOW)
    expect(weeksFrom(grey.rootsShowAt)!).toBeLessThan(weeksFrom(notGrey.rootsShowAt)!)
  })

  it('is due whenever the first of the two lands, and says which', () => {
    // A toner on a high-contrast base: the tone goes first.
    const toneFirst = predictFade(base({ kind: 'TONER', naturalLevel: 6, currentLevel: 7 }), NOW)
    expect(toneFirst.driver).toBe('TONE')
    expect(toneFirst.dueAt).toEqual(toneFirst.toneFadesAt)

    // A permanent tint on a level 4 going to level 9: the roots go first.
    const rootsFirst = predictFade(
      base({ kind: 'PERMANENT', naturalLevel: 4, currentLevel: 9 }),
      NOW,
    )
    expect(rootsFirst.driver).toBe('ROOTS')
    expect(rootsFirst.dueAt).toEqual(rootsFirst.rootsShowAt)
  })

  it('uses a measured growth rate over the average', () => {
    const fast = predictFade(base({ naturalLevel: 4, currentLevel: 9, growthCmPerMonth: 2 }), NOW)
    const slow = predictFade(base({ naturalLevel: 4, currentLevel: 9, growthCmPerMonth: 0.8 }), NOW)
    expect(weeksFrom(fast.rootsShowAt)!).toBeLessThan(weeksFrom(slow.rootsShowAt)!)
  })
})

describe('what the client does to it', () => {
  it('brings the tone forward for somebody washing it daily', () => {
    const daily = predictFade(base({ washesPerWeek: 7 }), NOW)
    const normal = predictFade(base({ washesPerWeek: 3 }), NOW)
    expect(daily.toneFadesAt!.getTime()).toBeLessThan(normal.toneFadesAt!.getTime())
  })

  it('pushes it back for somebody who barely washes it', () => {
    const rarely = predictFade(base({ washesPerWeek: 1 }), NOW)
    const normal = predictFade(base({ washesPerWeek: 3 }), NOW)
    expect(rarely.toneFadesAt!.getTime()).toBeGreaterThan(normal.toneFadesAt!.getTime())
  })

  it('counts chlorine, and counts purple shampoo the other way', () => {
    const swims = predictFade(base({ swimsChlorinatedWeekly: true }), NOW)
    const purple = predictFade(base({ usesPurpleShampoo: true }), NOW)
    const normal = predictFade(base(), NOW)
    expect(swims.toneFadesAt!.getTime()).toBeLessThan(normal.toneFadesAt!.getTime())
    expect(purple.toneFadesAt!.getTime()).toBeGreaterThan(normal.toneFadesAt!.getTime())
  })

  it('will not compound its way to an answer no colourist would sign', () => {
    /*
     * Daily washing AND chlorine AND hard water AND heat is a real client, and
     * an unclamped product of four terms puts their colour at a fortnight.
     */
    const worst = predictFade(
      base({
        kind: 'PERMANENT',
        washesPerWeek: 7,
        heatStylingPerWeek: 7,
        swimsChlorinatedWeekly: true,
        hardWater: true,
      }),
      NOW,
    )
    expect(weeksFrom(worst.toneFadesAt)!).toBeGreaterThanOrEqual(4)
  })
})

describe('what kind of colour a formula was', () => {
  it('reads the salon’s own vocabulary', () => {
    expect(colourKindOf('TONER', 6)).toBe('TONER')
    expect(colourKindOf('GLOSS', 6)).toBe('GLOSS')
    expect(colourKindOf('LIGHTENER', null)).toBe('BLEACH_AND_TONE')
    expect(colourKindOf('GLOBAL_COLOR', 20)).toBe('PERMANENT')
  })

  it('treats ten volume as the deposit-only formula it is', () => {
    // Whichever box the stylist ticked, it sits on the hair rather than
    // opening it, and it leaves like a gloss.
    expect(colourKindOf('GLOBAL_COLOR', 10)).toBe('GLOSS')
  })

  it('puts no fade date on something that is not colour', () => {
    // A keratin treatment has real regrowth and no tone to lose.
    expect(colourKindOf('TREATMENT', null)).toBeNull()
    expect(colourKindOf('PERM', null)).toBeNull()
    expect(colourKindOf('RELAXER', null)).toBeNull()
  })
})
