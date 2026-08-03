import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cn, THEME_FONT_SIZES } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

/**
 * The bug this guards against shipped, twice, without tripping anything.
 *
 * tailwind-merge only knows the stock theme, so `text-secondary` (a font size
 * here) and `text-ink-inverse` (a colour) both looked like text colours to it —
 * and it deleted whichever came first. Every primary button rendered black
 * text on blue, no error anywhere, and it took reading the pixels out of a
 * screenshot to see it. cn() now declares the theme's font sizes; these tests
 * are what keep that declaration true.
 */

describe('cn keeps a font size and a text colour apart', () => {
  it('a size does not eat the colour that precedes it', () => {
    const merged = cn('text-ink-inverse text-secondary')
    expect(merged).toContain('text-ink-inverse')
    expect(merged).toContain('text-secondary')
  })

  it('holds for every size in the theme', () => {
    for (const size of THEME_FONT_SIZES) {
      const merged = cn(`text-ink-inverse text-${size}`)
      expect(merged, size).toContain('text-ink-inverse')
      expect(merged, size).toContain(`text-${size}`)
    }
  })

  it('still lets a later colour beat an earlier one', () => {
    expect(cn('text-ink text-ink-inverse')).toBe('text-ink-inverse')
  })

  it('still lets a later size beat an earlier one', () => {
    expect(cn('text-body text-secondary')).toBe('text-secondary')
  })
})

describe('the button variants survive the merge', () => {
  // The exact combination that shipped broken: colour from the variant, size
  // from the size — the merged class list must keep both.
  it.each([
    ['primary', 'text-ink-inverse'],
    ['gold', 'text-ink'],
    ['danger', 'text-ink-inverse'],
    ['secondary', 'text-blue-900'],
  ] as const)('%s keeps its text colour at every size', (variant, colour) => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const merged = cn(buttonVariants({ variant, size }))
      expect(merged, `${variant}/${size}`).toContain(colour)
    }
  })
})

describe('the declared sizes match tailwind.config.ts', () => {
  /*
   * The protection only works while the list in utils.ts names every font size
   * the theme defines. A new size added to the config but not the list would
   * reopen the hole for exactly that size — so parse the real config.
   */
  it('THEME_FONT_SIZES names every fontSize key in the config', () => {
    const config = readFileSync(resolve(process.cwd(), 'tailwind.config.ts'), 'utf8')
    const block = config.match(/fontSize:\s*{([\s\S]*?)\n {6}}/)?.[1]
    expect(block, 'fontSize block not found in tailwind.config.ts').toBeTruthy()

    const declared = [...block!.matchAll(/^\s*'?([\w-]+)'?:\s*\[/gm)].map((m) => m[1])
    expect(declared.length).toBeGreaterThan(0)
    expect([...declared].sort()).toEqual([...THEME_FONT_SIZES].sort())
  })
})
