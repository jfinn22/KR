import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AA_LARGE, AA_NORMAL, AA_UI, contrastRatio, type Rgb } from '@/domain/branding/contrast'

/**
 * The palette is a product decision, so it gets a test.
 *
 * This parses the real tokens out of globals.css — not a duplicated copy — and
 * asserts WCAG AA contrast on every pair the design system actually uses. If
 * someone nudges a blue or a gold to "look nicer", this fails before it ships.
 *
 * `contrastRatio` is imported rather than defined here on purpose. A salon can
 * now supply its own accent at runtime, which this file cannot see — it reads a
 * shipped CSS file. Sharing one implementation with `deriveAccentLadder` is
 * what keeps the two halves of the guarantee honest about the same arithmetic.
 */

const CSS = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8')

/** Read a `--token: R G B;` channel triplet straight out of globals.css. */
function token(name: string): Rgb {
  const match = CSS.match(new RegExp(`--${name}:\\s*(\\d{1,3})\\s+(\\d{1,3})\\s+(\\d{1,3})\\s*;`))
  if (!match) throw new Error(`Token --${name} not found (or not an RGB triplet) in globals.css`)
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const
}

describe('palette tokens', () => {
  it('defines every token the Tailwind theme references', () => {
    const required = [
      'ink',
      'ink-muted',
      'ink-subtle',
      'ink-inverse',
      'canvas',
      'surface',
      'surface-alt',
      'line',
      'line-strong',
      'blue-900',
      'blue-700',
      'blue-500',
      'blue-300',
      'blue-100',
      'blue-50',
      'gold-700',
      'gold-600',
      'gold-500',
      'gold-300',
      'gold-100',
      'rose-700',
      'rose-500',
      'rose-100',
      'success',
      'success-soft',
      'warn',
      'warn-soft',
      'danger',
      'danger-soft',
    ]
    for (const t of required) expect(() => token(t), `--${t}`).not.toThrow()
  })
})

describe('body text contrast (WCAG AA, 4.5:1)', () => {
  const backgrounds = [
    'canvas',
    'surface',
    'surface-alt',
    'blue-50',
    'blue-100',
    'gold-100',
    'rose-100',
  ]

  it.each(backgrounds)('ink on %s', (bg) => {
    expect(contrastRatio(token('ink'), token(bg))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it.each(backgrounds)('ink-muted on %s', (bg) => {
    expect(contrastRatio(token('ink-muted'), token(bg))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  /*
   * The primary button is blue-500 — the lit rung, not the near-black one — so
   * that is the pair that has to hold. Lightening it any further to "make the
   * buttons pop" fails here rather than in front of a client.
   */
  it('white text on the primary button', () => {
    expect(contrastRatio(token('ink-inverse'), token('blue-500'))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('white text on the blue-700 hover state', () => {
    expect(contrastRatio(token('ink-inverse'), token('blue-700'))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('white text on the deepest blue, used for nav and active states', () => {
    expect(contrastRatio(token('ink-inverse'), token('blue-900'))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  /*
   * The gold button is a solid fill with BLACK type, which is the only way gold
   * carries text — white on gold is unreadable and always will be.
   */
  it('black text on the gold button', () => {
    expect(contrastRatio(token('ink'), token('gold-500'))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('black text on the gold hover state', () => {
    expect(contrastRatio(token('ink'), token('gold-300'))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('blue-700 is the text rung on the secondary button', () => {
    expect(contrastRatio(token('blue-700'), token('canvas'))).toBeGreaterThanOrEqual(AA_NORMAL)
    expect(contrastRatio(token('blue-700'), token('blue-50'))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('white text on the danger button', () => {
    expect(contrastRatio(token('ink-inverse'), token('danger'))).toBeGreaterThanOrEqual(AA_NORMAL)
  })
})

describe('accent text contrast', () => {
  // The gold ladder has exactly one text-safe rung. gold-700 carries type;
  // gold-600 is for borders and icons; gold-500/300/100 are fills only.
  // These assertions are what enforce that, rather than a comment nobody reads.
  it('gold-700 is the text-safe gold on white', () => {
    expect(contrastRatio(token('gold-700'), token('canvas'))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('gold-700 is readable on the gold wash', () => {
    expect(contrastRatio(token('gold-700'), token('gold-100'))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('gold-600 is a border/icon colour — it clears 3:1 but NOT the text bar', () => {
    const onWhite = contrastRatio(token('gold-600'), token('canvas'))
    expect(onWhite).toBeGreaterThanOrEqual(AA_UI)
    expect(onWhite).toBeLessThan(AA_NORMAL)
  })

  it('gold-500 is a fill only — it must fail the text bar', () => {
    expect(contrastRatio(token('gold-500'), token('canvas'))).toBeLessThan(AA_NORMAL)
  })

  it('link blue is readable on white', () => {
    expect(contrastRatio(token('blue-500'), token('canvas'))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  // Rose keeps gold's discipline: one text rung, one border rung, one wash.
  it('rose-700 is the text-safe rose on white and on the rose wash', () => {
    expect(contrastRatio(token('rose-700'), token('canvas'))).toBeGreaterThanOrEqual(AA_NORMAL)
    expect(contrastRatio(token('rose-700'), token('rose-100'))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('rose-500 is a border/icon colour — it clears 3:1 but NOT the text bar', () => {
    const onWhite = contrastRatio(token('rose-500'), token('canvas'))
    expect(onWhite).toBeGreaterThanOrEqual(AA_UI)
    expect(onWhite).toBeLessThan(AA_NORMAL)
  })

  it('blue-900 badge text is readable on the blue wash', () => {
    expect(contrastRatio(token('blue-900'), token('blue-100'))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it.each([
    ['success', 'success-soft'],
    ['warn', 'warn-soft'],
    ['danger', 'danger-soft'],
  ])('%s text on %s', (fg, bg) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it.each([['success'], ['warn'], ['danger']])('%s text on white', (fg) => {
    expect(contrastRatio(token(fg), token('canvas'))).toBeGreaterThanOrEqual(AA_NORMAL)
  })
})

describe('non-text contrast (WCAG AA, 3:1)', () => {
  it('the focus ring is visible against every surface', () => {
    for (const bg of ['canvas', 'surface', 'surface-alt']) {
      expect(contrastRatio(token('blue-500'), token(bg)), bg).toBeGreaterThanOrEqual(AA_UI)
    }
  })

  it('display headings clear the large-text bar on every surface', () => {
    for (const bg of ['canvas', 'surface', 'surface-alt', 'gold-100']) {
      expect(contrastRatio(token('ink'), token(bg)), bg).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })
})
