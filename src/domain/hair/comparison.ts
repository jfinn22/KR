import type { Level } from '@/domain/consultation/facts'
import { shadeByKey, type HairShade } from './tone'

/**
 * How far a reference picture is from the hair sitting under it.
 *
 * A client saves a photo because they like it, not because they have measured
 * it. The gap between "I like this" and "this is five levels lighter than you,
 * over box dye" is where every disappointing colour appointment lives, and it
 * has always been closed in the chair — on the day, with the client already
 * gowned and the afternoon already committed.
 *
 * Closing it at upload costs nothing and changes the conversation: a client who
 * sees "four levels lighter than where you are now" before they submit has been
 * told the truth while they can still act on it.
 *
 * Deliberately says nothing about how many visits it will take. That is the
 * rules engine's answer, decided from box dye, condition, porosity and the rest
 * of the facts — a second threshold living here would eventually disagree with
 * it, and the version the client saw first is the one they will hold the salon
 * to. This module reports distance; the plan reports visits.
 */

export type Direction = 'LIGHTER' | 'DARKER' | 'SAME'

/** Descriptive bands, not a promise. See the note above about visits. */
export type Reach = 'NONE' | 'SMALL' | 'MODERATE' | 'BIG'

export interface LevelComparison {
  /** The shade behind each end, when one was picked. Null for a bare level. */
  fromShade: HairShade | null
  toShade: HairShade | null
  fromLevel: Level
  toLevel: Level
  /** Always positive — the direction is carried separately. */
  levels: number
  direction: Direction
  reach: Reach
  /** One line, in the client's language. */
  summary: string
  /** How hair behaves at this distance. Null when there is nothing to say. */
  note: string | null
}

function bandOf(levels: number): Reach {
  if (levels === 0) return 'NONE'
  if (levels <= 2) return 'SMALL'
  if (levels <= 3) return 'MODERATE'
  return 'BIG'
}

/**
 * What is worth saying at this distance.
 *
 * Facts about hair rather than commitments about the appointment. Going lighter
 * and going darker are not symmetrical — lift is slow and exposes warmth, while
 * depositing over lifted hair goes on fast and can grab unevenly — and a client
 * who knows which of the two they are asking for is a client who is not
 * surprised.
 */
function noteFor(direction: Direction, levels: number, toLevel: Level): string | null {
  if (direction === 'SAME') return null

  if (direction === 'LIGHTER') {
    if (levels >= 4) {
      return 'A change this big is usually done in stages. Lifting that far in one go puts real stress on the hair and tends to leave warmth a toner can only partly cover.'
    }
    if (levels >= 3) return 'Lightening this far will show some warmth that needs toning out.'
    return 'A gentle lift — the kind of change that reads as brighter rather than different.'
  }

  if (toLevel <= 4 && levels >= 3) {
    return 'Going this much darker over lightened hair usually needs a filler first, or it grabs patchy and turns muddy.'
  }
  return 'Going darker is quicker than going lighter, but it is much harder to take back out.'
}

function summaryFor(direction: Direction, levels: number): string {
  if (direction === 'SAME') return 'About the same depth as your hair now.'
  const plural = levels === 1 ? 'level' : 'levels'
  return `${levels} ${plural} ${direction === 'LIGHTER' ? 'lighter' : 'darker'} than where you are now.`
}

/**
 * Compare a reference against where the hair is now.
 *
 * Both ends accept either a shade key from the chart or a bare level, because
 * the client's own colour can come from a shade question, from their hair
 * profile, or from an older consultation that only stored a number.
 */
export function compareToReference(input: {
  currentShadeKey?: string | null
  currentLevel?: Level | null
  referenceShadeKey?: string | null
  referenceLevel?: Level | null
}): LevelComparison | null {
  const fromShade = shadeByKey(input.currentShadeKey)
  const toShade = shadeByKey(input.referenceShadeKey)

  const fromLevel = fromShade?.level ?? input.currentLevel ?? null
  const toLevel = toShade?.level ?? input.referenceLevel ?? null

  // Nothing to compare is not an error — most references are never levelled,
  // and a client who skips it still gets the picture in front of the stylist.
  if (fromLevel == null || toLevel == null) return null

  const difference = toLevel - fromLevel
  const levels = Math.abs(difference)
  const direction: Direction = difference === 0 ? 'SAME' : difference > 0 ? 'LIGHTER' : 'DARKER'

  return {
    fromShade,
    toShade,
    fromLevel,
    toLevel,
    levels,
    direction,
    reach: bandOf(levels),
    summary: summaryFor(direction, levels),
    note: noteFor(direction, levels, toLevel),
  }
}
