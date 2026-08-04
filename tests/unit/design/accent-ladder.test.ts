import { describe, expect, it } from 'vitest'
import {
  AA_NORMAL,
  AA_UI,
  contrastRatio,
  deriveAccentLadder,
  parseHex,
  rgbToHsl,
  type AccentLadder,
} from '@/domain/branding/contrast'

/**
 * White-labelling must not be able to break contrast.
 *
 * `palette.test.ts` reads globals.css off disk, so it can only see the colours
 * shipped in the build — a salon's runtime accent is invisible to it, and the
 * guarantee would quietly stop holding the day branding shipped. These tests
 * are the other half: whatever a salon picks, the ladder derived from it clears
 * the same bars the shipped blue does.
 */

const WHITE = [255, 255, 255] as const
const INK = [11, 11, 12] as const
const INK_MUTED = [85, 85, 92] as const

const ladderOf = (hex: string): AccentLadder => {
  const result = deriveAccentLadder(hex)
  if (!result.ok) throw new Error(`${hex} unexpectedly rejected: ${result.reason}`)
  return result.ladder
}

const rgb = (hex: string) => {
  const parsed = parseHex(hex)
  if (!parsed) throw new Error(`bad hex ${hex}`)
  return parsed
}

/*
 * Colours a real salon would actually pick, including the awkward ones. Yellow
 * and lime are the interesting cases: they are bright, salons like them, and
 * they cannot carry white text at their natural lightness — so the ladder has
 * to move a long way or refuse.
 */
const BRAND_COLOURS = [
  ['the shipped blue', '#2E73B5'],
  ['a deep teal', '#0F766E'],
  ['a salon pink', '#C7457F'],
  ['a warm terracotta', '#C2571F'],
  ['a forest green', '#1E7A3C'],
  ['a royal purple', '#6D28D9'],
  ['a bright red', '#DC2626'],
  ['a mustard yellow', '#D4A017'],
  ['a shorthand hex', '#3B8'],
] as const

describe('a derived ladder clears every bar the shipped palette does', () => {
  it.each(BRAND_COLOURS)('%s', (_name, hex) => {
    const ladder = ladderOf(hex)

    // The three fills that carry white text — every primary button state.
    for (const rung of [900, 700, 500] as const) {
      expect(
        contrastRatio(rgb(ladder[rung]), WHITE),
        `white text on ${rung}`,
      ).toBeGreaterThanOrEqual(AA_NORMAL)
    }

    // 500 doubles as the link colour and the focus ring, so it has to be
    // readable ON white as well as under it.
    expect(contrastRatio(rgb(ladder[500]), WHITE), 'link on white').toBeGreaterThanOrEqual(
      AA_NORMAL,
    )

    // The border rung only has to be visible, not readable.
    expect(contrastRatio(rgb(ladder[300]), WHITE), 'border on white').toBeGreaterThanOrEqual(AA_UI)

    // Both washes carry body and muted text.
    for (const rung of [100, 50] as const) {
      expect(contrastRatio(rgb(ladder[rung]), INK), `ink on ${rung}`).toBeGreaterThanOrEqual(
        AA_NORMAL,
      )
      expect(
        contrastRatio(rgb(ladder[rung]), INK_MUTED),
        `muted ink on ${rung}`,
      ).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  it.each(BRAND_COLOURS)('%s stays in order from dark to light', (_name, hex) => {
    const ladder = ladderOf(hex)
    const lightness = ([900, 700, 500, 300, 100, 50] as const).map(
      (rung) => rgbToHsl(rgb(ladder[rung])).l,
    )
    for (let i = 1; i < lightness.length; i++) {
      expect(lightness[i]!, `rung ${i} lighter than the one before`).toBeGreaterThan(
        lightness[i - 1]!,
      )
    }
  })

  it.each(BRAND_COLOURS)('%s keeps its hue', (_name, hex) => {
    // The point of branding is that it looks like the salon's colour. A ladder
    // that met contrast by sliding to grey would pass every assertion above
    // and be worthless.
    const wanted = rgbToHsl(rgb(hex))
    const got = rgbToHsl(rgb(ladderOf(hex)[500]))
    const drift = Math.min(Math.abs(got.h - wanted.h), 1 - Math.abs(got.h - wanted.h))
    expect(drift, 'hue drift').toBeLessThan(0.02)
    expect(got.s, 'saturation kept').toBeGreaterThan(0.15)
  })
})

describe('it refuses rather than silently correcting', () => {
  it('rejects a colour that is not a colour', () => {
    for (const bad of ['', 'blue', '#12', '#GGGGGG', 'rgb(1,2,3)']) {
      const result = deriveAccentLadder(bad)
      expect(result.ok, bad).toBe(false)
    }
  })

  it('rejects a near-grey, because the branding would not read as branding', () => {
    const result = deriveAccentLadder('#8A8A8C')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/grey/i)
  })

  it('explains which pair failed, in words an owner can act on', () => {
    const result = deriveAccentLadder('#8A8A8C')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(20)
      // No ratios-and-jargon-only messages: it has to say what to do next.
      expect(result.reason).not.toMatch(/^[\d.:]+$/)
    }
  })

  it('shows its working on success, so a settings screen can display it', () => {
    const result = deriveAccentLadder('#2E73B5')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.measured.length).toBeGreaterThan(0)
      for (const m of result.measured) expect(m.ratio).toBeGreaterThanOrEqual(m.min)
    }
  })
})

describe('the derivation is deterministic', () => {
  it('gives the same ladder every time', () => {
    // A salon's brand cannot shift between page loads.
    expect(ladderOf('#C7457F')).toEqual(ladderOf('#C7457F'))
  })

  it('treats shorthand and longhand as the same colour', () => {
    expect(ladderOf('#3B8')).toEqual(ladderOf('#33BB88'))
  })
})
