import type { Level } from '@/domain/consultation/facts'
import { shadeByKey, type HairShade } from './tone'

/**
 * What the hair actually looks like on the way there.
 *
 * Every competitor that shows a client a "before and after" shows two pictures:
 * where you are, and where you want to be. The middle is where the
 * disappointment lives. A client going from a level 4 brown to platinum is not
 * shown three visits of orange, and so the first time they see orange is in the
 * mirror, halfway through, having paid for it.
 *
 * This is the middle, drawn honestly. It is deliberately built from data the
 * platform already holds and reasons the client can check:
 *
 *   where they are      their own answer, or their hair profile
 *   where they want     the shade on the reference picture
 *   how many visits     the rules engine's plan, not a second opinion
 *   what each stage     the underlying pigment chart below, which is
 *   looks like          physics rather than a promise
 *
 * NO GENERATED IMAGERY. A generated picture of *this client's* hair reads as a
 * promise about their hair specifically, which is the exact thing this product
 * exists not to do — and it would need a new port, generated-asset storage,
 * cost accounting and a liability story to say something less true than a row
 * of swatches.
 *
 * The session count comes from the engine and is never recomputed here. There
 * used to be one number in two places in this codebase and it cost a phase to
 * unpick; the rule is that the plan reports visits and everything else reads
 * them.
 */

/**
 * What is left when you take the colour out.
 *
 * Not a design choice — it is what melanin does under lift, and every colourist
 * knows the strip by heart. Dark hair does not go pale, it goes red, then
 * orange, then gold, then yellow, and the whole craft of blonding is getting
 * through that band and neutralising what remains.
 *
 * Showing it is the difference between "three visits" and "three visits, and
 * after the first one you will be copper".
 */
interface UnderlyingPigment {
  readonly level: Level
  readonly name: string
  /** Approximate, and deliberately muted so it reads as hair not paint. */
  readonly hex: string
}

const UNDERLYING: readonly UnderlyingPigment[] = [
  { level: 1, name: 'Blue-black', hex: '#0d0b0a' },
  { level: 2, name: 'Very dark brown', hex: '#241a15' },
  { level: 3, name: 'Dark red-brown', hex: '#4a2418' },
  { level: 4, name: 'Red', hex: '#6d2f19' },
  { level: 5, name: 'Red-orange', hex: '#8f431c' },
  { level: 6, name: 'Orange', hex: '#ab5c22' },
  { level: 7, name: 'Orange-gold', hex: '#c2792b' },
  { level: 8, name: 'Gold', hex: '#d5a03f' },
  { level: 9, name: 'Yellow', hex: '#e4c76a' },
  { level: 10, name: 'Pale yellow', hex: '#f0e0a8' },
]

export function underlyingPigmentAt(level: Level): UnderlyingPigment {
  return UNDERLYING[Math.min(10, Math.max(1, level)) - 1]!
}

export interface JourneyRung {
  /** 0 is where they are now; 1..n are the visits in the plan. */
  visit: number
  /** "Where you are now", or the session's own label from the plan. */
  label: string
  level: Level
  /** The swatch to draw. */
  hex: string
  /** What that swatch actually is, in words. */
  toneName: string
  /**
   * True when this rung is raw lifted hair rather than a finished colour.
   *
   * The single most important flag on the screen. An intermediate stage is
   * warm, and a client who thinks visit two leaves them beige will be upset by
   * visit two leaving them gold — even though gold at that level is exactly
   * what was supposed to happen.
   */
  isStagingPost: boolean
  /** One line about this step, or null when there is nothing worth saying. */
  note: string | null
}

export interface HairJourney {
  rungs: JourneyRung[]
  /** Positive when going lighter, negative when going darker. */
  levelsToTravel: number
  direction: 'LIGHTER' | 'DARKER' | 'SAME'
  /** Straight from the engine's plan. Never computed here. */
  visits: number
  /** The honest headline, in one line. */
  summary: string
  /**
   * Whether this is worth drawing at all.
   *
   * A single visit that moves nobody anywhere is a ladder with one rung on it,
   * which teaches a client nothing and takes up the best space on the screen.
   */
  worthShowing: boolean
}

export interface JourneyInput {
  currentShadeKey?: string | null
  currentLevel?: Level | null
  targetShadeKey?: string | null
  targetLevel?: Level | null
  /** The engine's session count, and its labels where it gave them. */
  visits: number
  sessionLabels?: readonly string[]
}

export function planJourney(input: JourneyInput): HairJourney | null {
  const fromShade = shadeByKey(input.currentShadeKey)
  const toShade = shadeByKey(input.targetShadeKey)

  const fromLevel = (fromShade?.level ?? input.currentLevel ?? null) as Level | null
  const toLevel = (toShade?.level ?? input.targetLevel ?? null) as Level | null

  // Nothing to draw is not an error. Most consultations never level their
  // reference, and a client who skipped it still gets everything else.
  if (fromLevel == null || toLevel == null) return null

  const visits = Math.max(1, Math.round(input.visits))
  const difference = toLevel - fromLevel
  const direction = difference === 0 ? 'SAME' : difference > 0 ? 'LIGHTER' : 'DARKER'

  const rungs: JourneyRung[] = [
    {
      visit: 0,
      label: 'Where you are now',
      level: fromLevel,
      hex: fromShade?.hex ?? underlyingPigmentAt(fromLevel).hex,
      toneName: fromShade?.name ?? underlyingPigmentAt(fromLevel).name,
      isStagingPost: false,
      note: null,
    },
  ]

  for (let visit = 1; visit <= visits; visit += 1) {
    const isLast = visit === visits
    /*
     * Evenly spaced, and rounded to a whole level because a colourist does not
     * think in halves. The last rung is the target exactly — the plan says it
     * gets there, so the ladder must not stop one short of what was promised.
     */
    const level = isLast
      ? toLevel
      : (clampLevel(Math.round(fromLevel + (difference * visit) / visits)) as Level)

    const label =
      input.sessionLabels?.[visit - 1] ?? (visits === 1 ? 'Your appointment' : `Visit ${visit}`)

    /*
     * The last rung wears the target's own colour, because that is the visit
     * the toner goes on. Every rung before it is raw lifted hair, and drawing
     * the target tone there would promise a client beige at a point where they
     * will actually be gold.
     */
    if (isLast) {
      rungs.push({
        visit,
        label,
        level,
        hex: toShade?.hex ?? underlyingPigmentAt(level).hex,
        toneName: toShade?.name ?? underlyingPigmentAt(level).name,
        isStagingPost: false,
        note: finalNote(direction, Math.abs(difference), visits),
      })
      continue
    }

    const pigment = underlyingPigmentAt(level)
    rungs.push({
      visit,
      label,
      level,
      hex: pigment.hex,
      toneName: pigment.name,
      isStagingPost: true,
      note: stagingNote(direction, pigment.name),
    })
  }

  return {
    rungs,
    levelsToTravel: difference,
    direction,
    visits,
    summary: summaryFor(direction, Math.abs(difference), visits),
    // One visit that moves nowhere is not a journey; it is an appointment.
    worthShowing: visits > 1 || Math.abs(difference) > 0,
  }
}

/**
 * What to say about a stage nobody is finishing on.
 *
 * Only for lightening. Going darker does not pass through the warm band — the
 * colour is deposited, so each visit ends on a real shade — and inventing a
 * warning for it would be noise that trains people to skip the real ones.
 */
function stagingNote(direction: HairJourney['direction'], toneName: string): string | null {
  if (direction !== 'LIGHTER') return null
  return `You leave this visit ${toneName.toLowerCase()}. That is the stage, not the result — it gets toned on the way to the finish.`
}

function finalNote(
  direction: HairJourney['direction'],
  levels: number,
  visits: number,
): string | null {
  if (direction === 'SAME') return null
  if (visits > 1) return 'This is the visit the colour is finished and toned.'
  if (direction === 'LIGHTER' && levels >= 3) {
    return 'Lifting this far in one go will leave warmth that the toner has to cover.'
  }
  return null
}

function summaryFor(direction: HairJourney['direction'], levels: number, visits: number): string {
  const trip = `${visits} visit${visits === 1 ? '' : 's'}`

  if (direction === 'SAME') {
    return visits === 1
      ? 'Staying at the depth you are now.'
      : `Staying at the depth you are now, over ${trip}.`
  }

  const way = direction === 'LIGHTER' ? 'lighter' : 'darker'
  const plural = levels === 1 ? 'level' : 'levels'
  return `${levels} ${plural} ${way}, over ${trip}.`
}

function clampLevel(value: number): number {
  return Math.min(10, Math.max(1, value))
}

/** Re-exported so a screen can label a swatch without importing two modules. */
export type { HairShade }
