/**
 * The shades a client can actually ask for.
 *
 * A single 1–10 strip from black to blonde is how a colourist thinks about
 * *depth*, and it is useless to a client who wants copper. "Level 6" describes
 * a dark blonde, a caramel brown and a bright copper equally well — they differ
 * in tone, and tone is the part the client cares about and the part that
 * changes the service.
 *
 * So the picker is two decisions. Pick the family (blonde, brown, red, grey,
 * vivid …), then pick the exact shade within it. What gets stored is a shade
 * key, and every shade carries the depth level it sits at — which is what the
 * engine needs to work out how much lift the service requires. The client picks
 * a colour by name; the engine still gets a number.
 *
 * Fashion shades are the reason a shade carries its level rather than being
 * derived from one. Pastel pink and lilac are both level 10 work because both
 * need a level 10 base, and deep violet is level 6 work — the vivid is a
 * separate decision from the depth it is applied over. Modelling a shade as
 * "name + the level it needs" is what a colourist actually does, and it means
 * two different pinks can honestly cost different amounts.
 *
 * Pure data and pure functions: no React, no database. The swatch hexes are
 * approximations of salon shade charts, deliberately muted rather than
 * saturated so they read as hair rather than paint.
 */

import type { Level } from '@/domain/consultation/facts'

export type ToneFamilyKey = 'NATURAL' | 'BLONDE' | 'BROWN' | 'RED' | 'BLACK' | 'GREY' | 'FASHION'

export interface HairShade {
  /** Stable across renames — this is what is stored in the answer and the fact. */
  readonly key: string
  /** What the client reads on the swatch. */
  readonly name: string
  /** Depth, 1 (black) to 10 (lightest blonde). What the lift maths runs on. */
  readonly level: Level
  /** Approximate swatch colour. Presentation only — never a stored value. */
  readonly hex: string
}

export interface ToneFamily {
  readonly key: ToneFamilyKey
  readonly label: string
  /** One line under the dropdown, in the client's language rather than ours. */
  readonly help: string
  readonly shades: readonly HairShade[]
}

const family = (
  key: ToneFamilyKey,
  label: string,
  help: string,
  shades: readonly [name: string, level: Level, hex: string][],
): ToneFamily => ({
  key,
  label,
  help,
  shades: shades.map(([name, level, hex]) => ({
    key: `${key}_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
    name,
    level,
    hex,
  })),
})

/**
 * Ordered as a client would scan them: their own colour first, then the three
 * things most people ask for, then the rest.
 */
export const TONE_FAMILIES: readonly ToneFamily[] = [
  family(
    'NATURAL',
    'Natural / undyed',
    'The colour your hair grows out of the scalp. Pick the closest.',
    [
      ['Black', 1, '#0d0b0a'],
      ['Darkest brown', 2, '#241a15'],
      ['Dark brown', 3, '#3b2a1e'],
      ['Medium brown', 4, '#54382a'],
      ['Light brown', 5, '#6f4a33'],
      ['Dark blonde', 6, '#8d6544'],
      ['Medium blonde', 7, '#ab8459'],
      ['Light blonde', 8, '#c6a479'],
      ['Very light blonde', 9, '#ddc6a1'],
      ['Lightest blonde', 10, '#efe0c4'],
    ],
  ),
  family(
    'BLONDE',
    'Blonde',
    'Warm through to icy. The lighter the shade, the more lift it needs.',
    [
      ['Dark golden blonde', 6, '#a9803f'],
      ['Honey blonde', 7, '#c49a52'],
      ['Golden blonde', 8, '#dab778'],
      ['Beige blonde', 9, '#e6d3ab'],
      ['Ash blonde', 9, '#d8d2c2'],
      ['Platinum', 10, '#ece7dc'],
      ['Icy white', 10, '#eeeef0'],
    ],
  ),
  family('BROWN', 'Brown / brunette', 'Espresso through to caramel.', [
    ['Espresso', 2, '#2a1a12'],
    ['Dark chocolate', 3, '#3f2718'],
    ['Chestnut', 4, '#573521'],
    ['Chocolate brown', 5, '#6e442a'],
    ['Ash brown', 5, '#5f4a3f'],
    ['Caramel brown', 6, '#8a5c3a'],
    ['Light caramel', 7, '#a5764f'],
  ]),
  family('RED', 'Red / copper', 'Burgundy through to strawberry. Reds fade fastest of anything.', [
    ['Deep burgundy', 3, '#4a1c14'],
    ['Mahogany', 4, '#6b2617'],
    ['Auburn', 5, '#8c3418'],
    ['Copper', 6, '#a94a1e'],
    ['Bright copper', 7, '#c3652b'],
    ['Strawberry blonde', 8, '#d98544'],
  ]),
  family('BLACK', 'Black', 'Black is easy to put on and the hardest thing to take back out.', [
    ['Jet black', 1, '#08070a'],
    ['Blue black', 2, '#131018'],
    ['Soft black', 3, '#1e1a22'],
  ]),
  family(
    'GREY',
    'Grey / silver',
    'Deliberate grey, not grow-out. Every one of these needs a lift.',
    [
      ['Charcoal', 5, '#5f6066'],
      ['Steel grey', 6, '#74757c'],
      ['Pewter', 7, '#8e8f97'],
      ['Silver', 8, '#adaeb6'],
      ['Pearl', 9, '#cbccd3'],
      ['White silver', 10, '#e8e9ee'],
    ],
  ),
  family(
    'FASHION',
    'Vivid / fashion',
    'The vivid goes over a lifted base — the shade you pick sets how light that base has to get.',
    [
      ['Deep violet', 6, '#4a2d6b'],
      ['Burgundy wine', 6, '#6b1f3a'],
      ['Emerald', 7, '#1f5f4a'],
      ['Teal', 8, '#1f6b73'],
      ['Rose gold', 8, '#c98a86'],
      ['Cobalt', 8, '#2b4a8f'],
      ['Pastel pink', 10, '#e8b4c8'],
      ['Lilac', 10, '#c4b0dd'],
      ['Mint', 10, '#b3dbc9'],
    ],
  ),
]

export const DEFAULT_FAMILY: ToneFamilyKey = 'NATURAL'

const SHADES_BY_KEY = new Map<string, { shade: HairShade; family: ToneFamily }>(
  TONE_FAMILIES.flatMap((f) => f.shades.map((shade) => [shade.key, { shade, family: f }] as const)),
)

export function shadeByKey(key: string | null | undefined): HairShade | null {
  if (!key) return null
  return SHADES_BY_KEY.get(key)?.shade ?? null
}

export function familyOfShade(key: string | null | undefined): ToneFamily | null {
  if (!key) return null
  return SHADES_BY_KEY.get(key)?.family ?? null
}

export function familyByKey(key: string | null | undefined): ToneFamily | null {
  return TONE_FAMILIES.find((f) => f.key === key) ?? null
}

/**
 * How a shade reads on the stylist's screen and in a plan.
 *
 * The level is always shown next to the name because the two answer different
 * questions — the name is what the client wants, the level is what the service
 * has to achieve, and a stylist reading the review needs both.
 */
export function describeShade(key: string | null | undefined): string | null {
  const found = shadeByKey(key)
  if (!found) return null
  return `${found.name} · level ${found.level}`
}

/**
 * The shape a level question is answered with.
 *
 * Kept structural rather than importing the picker's type, so the normaliser
 * can read it without the domain depending on a component.
 */
export interface ShadeAnswer {
  level: Level
  tone: string | null
}

/**
 * Read a level answer in either shape.
 *
 * Consultations answered before the picker gained tone families stored a bare
 * number, and those answers still have to evaluate — a client should not lose
 * a half-finished consultation to a deploy. A number still means a level; it
 * just carries no tone.
 */
export function readShadeAnswer(value: unknown): ShadeAnswer | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { level: clampLevel(value), tone: null }
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const tone = typeof record.tone === 'string' && record.tone !== '' ? record.tone : null
    const raw = record.level

    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return { level: clampLevel(raw), tone }
    }
    // A tone alone is still an answer — every shade knows its own level.
    const shade = shadeByKey(tone)
    if (shade) return { level: shade.level, tone }
  }

  return null
}

function clampLevel(value: number): Level {
  return Math.min(10, Math.max(1, Math.round(value))) as Level
}
