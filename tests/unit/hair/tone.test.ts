import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FAMILY,
  TONE_FAMILIES,
  describeShade,
  familyByKey,
  familyOfShade,
  readShadeAnswer,
  shadeByKey,
} from '@/domain/hair/tone'

/**
 * The shade chart is the client's half of the consultation — it is how somebody
 * says "copper" rather than "level 6". Most of what matters here is that a
 * shade key is stable and always resolves back to a real depth, because the
 * whole lift calculation is downstream of that number.
 */

describe('the shade chart', () => {
  it('offers a family for every way a client describes their colour', () => {
    expect(TONE_FAMILIES.map((f) => f.key)).toEqual([
      'NATURAL',
      'BLONDE',
      'BROWN',
      'RED',
      'BLACK',
      'GREY',
      'FASHION',
    ])
  })

  it('opens on natural, which is the one question every client can answer', () => {
    expect(familyByKey(DEFAULT_FAMILY)).not.toBeNull()
  })

  it('gives every shade a unique key, since the key is what gets stored', () => {
    const keys = TONE_FAMILIES.flatMap((f) => f.shades.map((s) => s.key))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps every shade on the 1–10 depth scale the engine runs on', () => {
    for (const f of TONE_FAMILIES) {
      for (const shade of f.shades) {
        expect(shade.level, `${shade.key}`).toBeGreaterThanOrEqual(1)
        expect(shade.level, `${shade.key}`).toBeLessThanOrEqual(10)
      }
    }
  })

  it('gives every shade a real swatch', () => {
    for (const f of TONE_FAMILIES) {
      for (const shade of f.shades) {
        expect(shade.hex, shade.key).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('covers the whole scale between them, so nobody is unrepresented', () => {
    const levels = new Set(TONE_FAMILIES.flatMap((f) => f.shades.map((s) => s.level)))
    expect([...levels].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  /*
   * Two pinks at the same depth is the case the model exists for: pastel pink
   * and lilac both need a level 10 base, so the level cannot identify a shade
   * and the key has to.
   */
  it('lets one family hold two different shades at the same depth', () => {
    const vivid = familyByKey('FASHION')!
    const atTen = vivid.shades.filter((s) => s.level === 10)
    expect(atTen.length).toBeGreaterThan(1)
    expect(new Set(atTen.map((s) => s.key)).size).toBe(atTen.length)
  })

  it('resolves a shade back to its family', () => {
    const copper = TONE_FAMILIES.find((f) => f.key === 'RED')!.shades.find(
      (s) => s.name === 'Copper',
    )!
    expect(familyOfShade(copper.key)?.key).toBe('RED')
    expect(shadeByKey(copper.key)?.level).toBe(6)
  })

  it('returns nothing for a shade that does not exist rather than guessing', () => {
    expect(shadeByKey('BLONDE_MADE_UP')).toBeNull()
    expect(familyOfShade(null)).toBeNull()
    expect(describeShade(undefined)).toBeNull()
  })

  // A stylist reading the review needs the name and the depth together.
  it('describes a shade with both what it is called and how deep it is', () => {
    const honey = shadeByKey('BLONDE_HONEY_BLONDE')
    expect(honey?.name).toBe('Honey blonde')
    expect(describeShade('BLONDE_HONEY_BLONDE')).toBe('Honey blonde · level 7')
  })
})

describe('reading a level answer', () => {
  it('reads the shape the picker sends', () => {
    expect(readShadeAnswer({ level: 8, tone: 'BLONDE_GOLDEN_BLONDE' })).toEqual({
      level: 8,
      tone: 'BLONDE_GOLDEN_BLONDE',
    })
  })

  /*
   * Consultations started before the picker had tone families stored a bare
   * number. Those clients should not lose a half-finished consultation to a
   * deploy, so a number is still a valid answer — it just carries no tone.
   */
  it('still reads a bare level from before tones existed', () => {
    expect(readShadeAnswer(6)).toEqual({ level: 6, tone: null })
  })

  it('takes the depth from the shade when only a tone came through', () => {
    expect(readShadeAnswer({ tone: 'FASHION_PASTEL_PINK' })).toEqual({
      level: 10,
      tone: 'FASHION_PASTEL_PINK',
    })
  })

  it('clamps a level that could never exist onto the scale', () => {
    expect(readShadeAnswer(99)?.level).toBe(10)
    expect(readShadeAnswer(-4)?.level).toBe(1)
    expect(readShadeAnswer(6.6)?.level).toBe(7)
  })

  it('refuses anything that is not an answer', () => {
    expect(readShadeAnswer(null)).toBeNull()
    expect(readShadeAnswer('seven')).toBeNull()
    expect(readShadeAnswer({})).toBeNull()
    expect(readShadeAnswer({ tone: 'NOT_A_SHADE' })).toBeNull()
    expect(readShadeAnswer(Number.NaN)).toBeNull()
  })
})
