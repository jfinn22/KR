/**
 * Contrast arithmetic, and the ladder a salon's brand colour turns into.
 *
 * This used to live inside `tests/unit/design/palette.test.ts`, which parses
 * globals.css off disk and asserts WCAG AA on every pair the design system
 * uses. That test is the reason the palette cannot silently rot — but it reads
 * a FILE, so it can only see the colours shipped in the build. The moment a
 * salon picks its own accent at runtime, the guarantee stops holding and the
 * test carries on passing.
 *
 * So the maths moves here, the test imports it, and the same functions run
 * again when a salon saves a brand colour. One definition of "readable",
 * enforced in both places.
 *
 * Pure: no I/O, no framework. WCAG 2.1 relative luminance and contrast ratio.
 */

export type Rgb = readonly [number, number, number]

export const AA_NORMAL = 4.5
export const AA_LARGE = 3.0
/** Non-text: focus rings, borders, icons. */
export const AA_UI = 3.0

/* -------------------------------------------------------------------------
 * Conversions
 * ---------------------------------------------------------------------- */

export function parseHex(hex: string): Rgb | null {
  const cleaned = hex.trim().replace(/^#/, '')
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ] as const
}

export function toHex([r, g, b]: Rgb): string {
  const part = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase()
}

/** The channel triplet form globals.css stores, so alpha modifiers work. */
export function toChannels([r, g, b]: Rgb): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `${part(r)} ${part(g)} ${part(b)}`
}

function srgbToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/* -------------------------------------------------------------------------
 * HSL, so a ladder can keep the brand's hue and move only its lightness
 * ---------------------------------------------------------------------- */

export interface Hsl {
  h: number
  s: number
  l: number
}

export function rgbToHsl([r, g, b]: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min

  if (d === 0) return { h: 0, s: 0, l }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6

  return { h, s, l }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = l * 255
    return [v, v, v] as const
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q

  const channel = (t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }

  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255] as const
}

/* -------------------------------------------------------------------------
 * The ladder
 * ---------------------------------------------------------------------- */

/**
 * The rungs a brand accent has to fill.
 *
 * These are the blue family's names, because blue is the family a brand
 * replaces: it is the one the palette calls "structure and action" — every
 * primary button, link, focus ring and active nav state. Gold and rose stay
 * fixed for every salon on the platform, because their meaning is not the
 * salon's to change: gold is money and status, rose is the hair itself. A
 * client only ever sees one salon, so the action colour can move; the
 * semantics cannot.
 */
export interface AccentLadder {
  900: string
  700: string
  500: string
  300: string
  100: string
  50: string
}

const WHITE: Rgb = [255, 255, 255]
const INK: Rgb = [11, 11, 12]
const INK_MUTED: Rgb = [85, 85, 92]

/**
 * The constraints a ladder has to satisfy, restated as data.
 *
 * `tests/unit/design/palette.test.ts` asserts each of these against the real
 * globals.css. A derived ladder has to clear the same bar or a salon could
 * brand its way to an unreadable button.
 *
 * Note there is no separate entry for "the link colour on white". Contrast is
 * symmetric, so white-text-on-500 and 500-as-a-link-on-white are arithmetically
 * the same pair — listing both would just check one thing twice.
 */
type Requirement = {
  rung: keyof AccentLadder
  /** What sits on it, or what it sits on. */
  against: Rgb
  min: number
  label: string
}

const REQUIREMENTS: readonly Requirement[] = [
  { rung: 900, against: WHITE, min: AA_NORMAL, label: 'white text on the deepest rung' },
  { rung: 700, against: WHITE, min: AA_NORMAL, label: 'white text on the hover state' },
  {
    rung: 500,
    against: WHITE,
    min: AA_NORMAL,
    label: 'white text on the primary button, and the link colour on white',
  },
  { rung: 300, against: WHITE, min: AA_UI, label: 'the border rung against white' },
  { rung: 100, against: INK, min: AA_NORMAL, label: 'body text on the wash' },
  { rung: 100, against: INK_MUTED, min: AA_NORMAL, label: 'muted text on the wash' },
  { rung: 50, against: INK, min: AA_NORMAL, label: 'body text on the palest wash' },
  { rung: 50, against: INK_MUTED, min: AA_NORMAL, label: 'muted text on the palest wash' },
]

/**
 * The colour as it will actually exist — 8-bit channels, not real numbers.
 *
 * The searches below MUST measure this rather than the continuous value.
 * Bisecting to the exact boundary in float and then rounding to hex moves the
 * colour by up to half a channel, which is enough to land a rung at 2.99:1
 * after it was solved to 3.00:1. Quantising inside the search means the bound
 * it returns is the bound the browser gets.
 */
function quantise(hsl: Hsl): Rgb {
  const [r, g, b] = hslToRgb(hsl)
  return [Math.round(r), Math.round(g), Math.round(b)] as const
}

/**
 * The lightest this colour can be and still clear `min` against something pale.
 *
 * Contrast against white falls as lightness rises, so the passing set is
 * `[0, answer]` and the answer is its upper edge — the lightest version of the
 * salon's colour that still carries white text. Taking the edge rather than a
 * fixed step keeps the result as close to what they actually picked as the law
 * allows.
 */
function lightestPassing(base: Hsl, against: Rgb, min: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (contrastRatio(quantise({ ...base, l: mid }), against) >= min) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * The darkest this colour can be and still clear `min` against something dark.
 *
 * The mirror of the above, for washes: contrast against black text rises with
 * lightness, so the passing set is `[answer, 1]` and we want its lower edge —
 * the most colour we can keep in a wash that still carries body text.
 */
function darkestPassing(base: Hsl, against: Rgb, min: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (contrastRatio(quantise({ ...base, l: mid }), against) >= min) hi = mid
    else lo = mid
  }
  return hi
}

export interface LadderFailure {
  ok: false
  /** Which requirement could not be met, in words a salon owner can act on. */
  reason: string
  label: string
}

export interface LadderSuccess {
  ok: true
  ladder: AccentLadder
  /** Measured ratios, so a settings screen can show its working. */
  measured: { label: string; ratio: number; min: number }[]
}

/**
 * Turn one brand colour into a full, compliant accent ladder.
 *
 * A salon picks a single colour. The palette needs six rungs, and each has a
 * different job — a fill that carries white text, a wash that carries black
 * text, a border that only has to be visible. Deriving them keeps the brand's
 * hue and moves lightness until each rung clears the bar its job requires.
 *
 * Returns a failure rather than a silently-corrected colour when the result
 * would no longer resemble what was chosen: telling somebody their pale yellow
 * became a dark olive is better than shipping a dark olive they did not pick.
 */
export function deriveAccentLadder(hex: string): LadderSuccess | LadderFailure {
  const rgb = parseHex(hex)
  if (!rgb) {
    return {
      ok: false,
      label: 'colour',
      reason: 'That is not a colour we can read. Use a hex value like #2E73B5.',
    }
  }

  const base = rgbToHsl(rgb)

  // A near-grey brand colour produces a ladder that is grey at every rung,
  // which reads as "the branding did not work" rather than as a choice.
  if (base.s < 0.08) {
    return {
      ok: false,
      label: 'colour',
      reason:
        'That colour is too close to grey to use as an accent — buttons and links would be indistinguishable from ordinary text.',
    }
  }

  /*
   * Anchor on 500 and derive outward, rather than solving each rung against
   * its own constraint independently.
   *
   * Solving independently looks reasonable and is wrong: for a light hue —
   * a mustard, a lime — the 500 has to travel a long way down to carry white
   * text, while the 700 already passed at its nominal lightness. The 500 ends
   * up DARKER than the 700 and the ladder is out of order, which is how a teal
   * and a mustard both got refused for "not enough depth" when the real fault
   * was the method.
   *
   * Anchoring makes the ordering structural: everything below 500 is a
   * fraction of it, everything above is solved upward from it.
   */
  /*
   * Saturation tapers toward the pale end, and each rung is SOLVED at the
   * saturation it will ship with.
   *
   * The taper is what stops a teal's wash coming out a fluorescent cyan —
   * compare the shipped palette, where blue-500 is a solid #2E73B5 and blue-100
   * is a barely-there #E2EEFA. A wash is a hint of the colour, not the colour
   * turned up.
   *
   * Applying it after solving looks equivalent and is not. Desaturating does
   * not move luminance in one direction: green carries 0.72 of the luminance
   * coefficient, so draining a teal at fixed lightness makes it markedly
   * DARKER and its wash stops carrying body text, while draining a purple
   * makes it lighter and its border rung stops being visible. Both happened.
   * Solving at the final saturation removes the question.
   */
  const at = (satFactor: number): Hsl => ({ ...base, s: base.s * satFactor })

  const l500 = lightestPassing(at(1), WHITE, AA_NORMAL)

  // Darker than a rung that already carries white text also carries it, so
  // these need no search of their own.
  const l700 = l500 * 0.72
  const l900 = l500 * 0.44

  /*
   * The border rung: as pale as it can be while staying visible against white.
   *
   * No separation nudge. A 3:1 bar is always easier than 4.5:1, so this lands
   * lighter than 500 on its own — and forcing extra distance is what pushed a
   * mustard's border rung back under the bar it had just cleared. The
   * constraint decides; the ordering is then checked, not assumed.
   */
  const l300 = lightestPassing(at(0.82), WHITE, AA_UI)

  // The washes carry body text, so they are bounded from below. Muted ink is
  // the binding one — it is paler than body ink, so it needs a paler wash.
  // Separation from 300 is safe to force upward: for a wash, lighter is the
  // direction that gains contrast against the dark text sitting on it.
  /*
   * The two washes aim for a pale tint and use the contrast bar only as a
   * floor.
   *
   * Taking the boundary itself would give the DARKEST wash that is still
   * legal, which is the opposite of what a wash is for — the shipped blue-100
   * is #E2EEFA, a hint of colour behind black text, not a mid-tone the text
   * has to fight. These targets sit close to the shipped palette's own
   * lightness; the `max` only bites for a hue so dark it cannot reach them.
   */
  const WASH_TARGET = 0.92
  const PALEST_TARGET = 0.965

  const l100 = Math.max(
    darkestPassing(at(0.42), INK, AA_NORMAL),
    darkestPassing(at(0.42), INK_MUTED, AA_NORMAL),
    l300 + 0.04,
    WASH_TARGET,
  )
  const l50 = Math.max(
    darkestPassing(at(0.34), INK_MUTED, AA_NORMAL),
    Math.min(1, l100 + (1 - l100) * 0.45),
    PALEST_TARGET,
  )

  const solved: Record<keyof AccentLadder, Hsl> = {
    900: { ...at(1), l: l900 },
    700: { ...at(1), l: l700 },
    500: { ...at(1), l: l500 },
    300: { ...at(0.82), l: l300 },
    100: { ...at(0.42), l: l100 },
    50: { ...at(0.34), l: l50 },
  }

  /*
   * Verify rather than trust. The construction above should satisfy every
   * requirement, but a rung nudged to preserve ordering could in principle
   * cross a bar — so measure all of them with the same function the palette
   * test uses, and refuse if anything falls short.
   */
  const measured: LadderSuccess['measured'] = []
  for (const req of REQUIREMENTS) {
    // `quantise`, not `hslToRgb` — the search and the emitted hex both work in
    // 8-bit, and a verification measuring the continuous value would disagree
    // with both of them by a hair at exactly the boundary.
    const ratio = contrastRatio(quantise(solved[req.rung]), req.against)
    measured.push({ label: req.label, ratio: Number(ratio.toFixed(2)), min: req.min })
    if (ratio < req.min) {
      return {
        ok: false,
        label: req.label,
        reason: `That colour cannot carry ${req.label} at the contrast the law requires — it reaches ${ratio.toFixed(2)}:1 and needs ${req.min}:1. Try a deeper or a paler version of it.`,
      }
    }
  }

  const rungs: (keyof AccentLadder)[] = [900, 700, 500, 300, 100, 50]
  for (let i = 1; i < rungs.length; i++) {
    const previous = rungs[i - 1]!
    const current = rungs[i]!
    if (solved[current].l <= solved[previous].l) {
      return {
        ok: false,
        label: 'ladder',
        reason:
          'That colour cannot be spread across light and dark shades while staying readable. Try one with a little more depth to it.',
      }
    }
  }

  return {
    ok: true,
    measured,
    ladder: {
      900: toHex(quantise(solved[900])),
      700: toHex(quantise(solved[700])),
      500: toHex(quantise(solved[500])),
      300: toHex(quantise(solved[300])),
      100: toHex(quantise(solved[100])),
      50: toHex(quantise(solved[50])),
    },
  }
}
