import { describe, expect, it } from 'vitest'
import { planJourney, underlyingPigmentAt } from '@/domain/hair/journey'

/**
 * The middle of the journey.
 *
 * Every competitor shows a before and an after. The middle is where the
 * disappointment lives — a client going to platinum from a level 4 is not
 * shown three visits of orange, so the first time they see orange is in the
 * mirror, halfway through, having paid for it.
 */

const PLATINUM = 'BLONDE_PLATINUM' // level 10
const CHESTNUT = 'BROWN_CHESTNUT' // level 4

describe('what is left when you take the colour out', () => {
  it('is the strip every colourist knows by heart', () => {
    // Dark hair does not go pale. It goes red, then orange, then gold.
    expect(underlyingPigmentAt(4).name).toMatch(/red/i)
    expect(underlyingPigmentAt(6).name).toMatch(/orange/i)
    expect(underlyingPigmentAt(8).name).toMatch(/gold/i)
    expect(underlyingPigmentAt(10).name).toMatch(/pale yellow/i)
  })

  it('clamps rather than falling off either end', () => {
    expect(underlyingPigmentAt(0 as never).level).toBe(1)
    expect(underlyingPigmentAt(99 as never).level).toBe(10)
  })
})

describe('drawing the way there', () => {
  it('starts where the client actually is', () => {
    const journey = planJourney({
      currentShadeKey: CHESTNUT,
      targetShadeKey: PLATINUM,
      visits: 3,
    })!

    expect(journey.rungs[0]).toMatchObject({
      visit: 0,
      level: 4,
      label: 'Where you are now',
      isStagingPost: false,
    })
  })

  it('has one rung per visit, plus the starting point', () => {
    const journey = planJourney({
      currentShadeKey: CHESTNUT,
      targetShadeKey: PLATINUM,
      visits: 3,
    })!

    expect(journey.rungs).toHaveLength(4)
    expect(journey.rungs.map((r) => r.visit)).toEqual([0, 1, 2, 3])
  })

  it('lands exactly on what was promised', () => {
    /*
     * The plan says three visits gets there, so the ladder must not stop one
     * short — a client shown a ladder that ends at level 9 has been quoted for
     * platinum and drawn something else.
     */
    const journey = planJourney({
      currentShadeKey: CHESTNUT,
      targetShadeKey: PLATINUM,
      visits: 3,
    })!

    const last = journey.rungs.at(-1)!
    expect(last.level).toBe(10)
    expect(last.toneName).toBe('Platinum')
    expect(last.isStagingPost).toBe(false)
  })

  it('shows raw lifted hair in between, not the target tone', () => {
    /*
     * This is the whole point. Drawing platinum at visit two promises a client
     * beige at a point where they will actually be gold — and gold at that
     * level is exactly what was supposed to happen, so the surprise is the
     * software's fault rather than the colourist's.
     */
    const journey = planJourney({
      currentShadeKey: CHESTNUT,
      targetShadeKey: PLATINUM,
      visits: 3,
    })!

    const middle = journey.rungs.filter((r) => r.visit > 0 && r.visit < 3)
    expect(middle).toHaveLength(2)
    for (const rung of middle) {
      expect(rung.isStagingPost).toBe(true)
      expect(rung.toneName).not.toBe('Platinum')
      expect(rung.note).toMatch(/that is the stage, not the result/i)
    }
    // Level 6 then level 8: orange, then gold.
    expect(middle.map((r) => r.toneName)).toEqual(['Orange', 'Gold'])
  })

  it('never invents a session count of its own', () => {
    /*
     * The plan reports visits; everything else reads them. There used to be
     * one number in two places in this codebase and it cost a phase to unpick.
     */
    const four = planJourney({ currentLevel: 4, targetLevel: 10, visits: 4 })!
    const two = planJourney({ currentLevel: 4, targetLevel: 10, visits: 2 })!

    expect(four.visits).toBe(4)
    expect(four.rungs).toHaveLength(5)
    expect(two.visits).toBe(2)
    expect(two.rungs).toHaveLength(3)
  })

  it('uses the plan’s own labels where it gave them', () => {
    const journey = planJourney({
      currentLevel: 4,
      targetLevel: 10,
      visits: 2,
      sessionLabels: ['First lift', 'Second lift and tone'],
    })!

    expect(journey.rungs.map((r) => r.label)).toEqual([
      'Where you are now',
      'First lift',
      'Second lift and tone',
    ])
  })
})

describe('going darker is a different shape', () => {
  it('does not warn about warmth that never appears', () => {
    /*
     * Depositing colour ends each visit on a real shade rather than passing
     * through the warm band. A staging warning here would be noise, and noise
     * trains people to skip the real ones.
     */
    const journey = planJourney({
      currentShadeKey: PLATINUM,
      targetShadeKey: CHESTNUT,
      visits: 2,
    })!

    expect(journey.direction).toBe('DARKER')
    const staging = journey.rungs.filter((r) => r.isStagingPost)
    expect(staging.every((r) => r.note === null)).toBe(true)
  })

  it('counts the levels travelled with a sign', () => {
    const down = planJourney({ currentLevel: 9, targetLevel: 4, visits: 1 })!
    expect(down.levelsToTravel).toBe(-5)
    expect(down.summary).toMatch(/5 levels darker/i)
  })
})

describe('when there is nothing worth drawing', () => {
  it('returns nothing at all if either end is unknown', () => {
    // Most references are never levelled, and that is an ordinary case rather
    // than an error — the client still gets everything else on the screen.
    expect(planJourney({ currentLevel: 5, visits: 1 })).toBeNull()
    expect(planJourney({ targetLevel: 5, visits: 1 })).toBeNull()
  })

  it('says a single visit that moves nowhere is not worth the space', () => {
    const journey = planJourney({ currentLevel: 6, targetLevel: 6, visits: 1 })!
    expect(journey.worthShowing).toBe(false)
  })

  it('but a single visit that moves four levels very much is', () => {
    const journey = planJourney({ currentLevel: 6, targetLevel: 10, visits: 1 })!
    expect(journey.worthShowing).toBe(true)
    expect(journey.rungs.at(-1)!.note).toMatch(/warmth/i)
  })

  it('and so is a multi-visit plan that stays put', () => {
    // Two visits at the same depth is a correction, and the client should see
    // that it is two visits.
    const journey = planJourney({ currentLevel: 6, targetLevel: 6, visits: 2 })!
    expect(journey.worthShowing).toBe(true)
  })
})

describe('a bare level still works', () => {
  it('falls back to the pigment strip for a swatch when no shade was picked', () => {
    const journey = planJourney({ currentLevel: 5, targetLevel: 8, visits: 1 })!

    expect(journey.rungs[0]!.toneName).toBe('Red-orange')
    expect(journey.rungs[0]!.hex).toMatch(/^#[0-9a-f]{6}$/i)
    expect(journey.rungs[1]!.toneName).toBe('Gold')
  })
})
