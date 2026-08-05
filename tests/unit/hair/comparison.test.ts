import { describe, expect, it } from 'vitest'
import { compareToReference } from '@/domain/hair/comparison'
import { shadeByKey } from '@/domain/hair/tone'

/**
 * The gap between "I like this picture" and "this is five levels lighter than
 * you". Every disappointing colour appointment lives in that gap, and it has
 * always been closed in the chair — on the day, with the client gowned and the
 * afternoon already committed.
 */

// Level 5 light brown, level 10 platinum, level 2 espresso.
const BROWN = 'NATURAL_LIGHT_BROWN'
const PLATINUM = 'BLONDE_PLATINUM'
const ESPRESSO = 'BROWN_ESPRESSO'

describe('measuring a reference against the hair under it', () => {
  it('reads the level out of each shade rather than being told it', () => {
    const result = compareToReference({ currentShadeKey: BROWN, referenceShadeKey: PLATINUM })!
    expect(result.fromLevel).toBe(shadeByKey(BROWN)!.level)
    expect(result.toLevel).toBe(shadeByKey(PLATINUM)!.level)
  })

  it('reports the distance and which way it goes', () => {
    const lighter = compareToReference({ currentShadeKey: BROWN, referenceShadeKey: PLATINUM })!
    expect(lighter.direction).toBe('LIGHTER')
    expect(lighter.levels).toBe(5)
    expect(lighter.summary).toBe('5 levels lighter than where you are now.')
  })

  it('reports the same distance the other way round', () => {
    const darker = compareToReference({ currentShadeKey: PLATINUM, referenceShadeKey: ESPRESSO })!
    expect(darker.direction).toBe('DARKER')
    // Positive either way — the sign lives in `direction`.
    expect(darker.levels).toBe(8)
  })

  it('says so when there is no real change', () => {
    const same = compareToReference({ currentShadeKey: BROWN, referenceShadeKey: BROWN })!
    expect(same.direction).toBe('SAME')
    expect(same.levels).toBe(0)
    expect(same.note).toBeNull()
  })

  it('gets the plural right for one level', () => {
    const result = compareToReference({ currentLevel: 5, referenceLevel: 6 })!
    expect(result.summary).toBe('1 level lighter than where you are now.')
  })
})

describe('what it accepts at each end', () => {
  // The client's own colour can come from a shade question, a hair profile
  // that stores only depth, or an older consultation that stored a number.
  it('takes a bare level where no shade was picked', () => {
    const result = compareToReference({ currentLevel: 4, referenceShadeKey: PLATINUM })!
    expect(result.fromShade).toBeNull()
    expect(result.fromLevel).toBe(4)
    expect(result.levels).toBe(6)
  })

  it('prefers the shade over a level given alongside it', () => {
    // A shade knows its own depth; a stale number beside it does not win.
    const result = compareToReference({
      currentShadeKey: BROWN,
      currentLevel: 9,
      referenceShadeKey: PLATINUM,
    })!
    expect(result.fromLevel).toBe(5)
  })

  /*
   * Most references are never levelled, and a client who skips it still gets
   * their picture in front of the stylist. Nothing here is a blocker.
   */
  it('returns nothing rather than guessing when one end is missing', () => {
    expect(compareToReference({ currentShadeKey: BROWN })).toBeNull()
    expect(compareToReference({ referenceShadeKey: PLATINUM })).toBeNull()
    expect(compareToReference({})).toBeNull()
  })

  it('returns nothing for a shade key that is not on the chart', () => {
    expect(compareToReference({ currentShadeKey: 'NOT_A_SHADE', referenceLevel: 8 })).toBeNull()
  })
})

describe('what it tells the client', () => {
  it('warns that a big lift is usually staged', () => {
    const result = compareToReference({ currentLevel: 4, referenceLevel: 9 })!
    expect(result.reach).toBe('BIG')
    expect(result.note).toMatch(/stages/i)
  })

  it('treats a small lift as the small thing it is', () => {
    const result = compareToReference({ currentLevel: 6, referenceLevel: 7 })!
    expect(result.reach).toBe('SMALL')
    expect(result.note).toMatch(/gentle/i)
  })

  // Lift and deposit are not symmetrical, and a client who knows which one
  // they are asking for is a client who is not surprised.
  it('says something different about going darker', () => {
    const darker = compareToReference({ currentLevel: 9, referenceLevel: 3 })!
    expect(darker.note).toMatch(/filler/i)
  })

  it('still says the ordinary thing about a mild darkening', () => {
    const darker = compareToReference({ currentLevel: 7, referenceLevel: 6 })!
    expect(darker.note).toMatch(/harder to take back out/i)
  })

  /*
   * How many visits it takes is the rules engine's answer, decided from box
   * dye, condition and porosity — none of which this sees. A second threshold
   * here would eventually disagree, and the number the client saw first is the
   * one they hold the salon to.
   */
  it('never promises a number of visits', () => {
    for (const [from, to] of [
      [2, 10],
      [4, 9],
      [5, 8],
      [10, 2],
    ] as const) {
      const result = compareToReference({ currentLevel: from, referenceLevel: to })!
      expect(`${result.summary} ${result.note ?? ''}`).not.toMatch(
        /\b(one|two|three|1|2|3)\s+(visit|session|appointment)/i,
      )
    }
  })
})
