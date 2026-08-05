/**
 * When the colour will go, and when the roots will show.
 *
 * The two clocks a colour client actually lives by, and they run at different
 * speeds: a toner is gone at four weeks while the regrowth is still invisible,
 * and a permanent tint on a low-contrast base holds its tone long after the
 * parting has given the game away. Whichever comes first is when they need to
 * be back, and it is almost never the six or twelve weeks a salon quotes
 * everybody.
 *
 * What this is: arithmetic over stated assumptions, calibrated to the rules of
 * thumb colourists already use. What it is NOT: a measurement. Every constant
 * below is a starting point somebody should be able to argue with, which is
 * why they are all named and none are buried in an expression.
 *
 * The honesty rule matters more than the accuracy. A prediction with no date to
 * work from returns nothing and says what it would need — because a confident
 * wrong date is worse than an empty space. An empty space gets asked about; a
 * date gets believed, and the client is told to come back at the wrong time by
 * a screen that looks certain.
 */

/** What kind of colour it was. They do not fade remotely alike. */
export type ColourKind = 'TONER' | 'GLOSS' | 'PERMANENT' | 'BLEACH_AND_TONE'

export interface FadeInputs {
  /** When the colour actually went on. Without it there is no prediction. */
  colouredAt: Date | null
  kind: ColourKind | null

  /** The level underneath, and the level they are wearing. */
  naturalLevel: number | null
  currentLevel: number | null
  greyPercent: number | null

  washesPerWeek: number | null
  heatStylingPerWeek: number | null
  swimsChlorinatedWeekly: boolean
  usesPurpleShampoo: boolean
  hardWater: boolean

  /** Centimetres a month, where anybody has measured it. */
  growthCmPerMonth: number | null
}

export interface FadePrediction {
  /** When the tone will have visibly shifted. Null when it cannot be said. */
  toneFadesAt: Date | null
  /** When regrowth reaches the point where it reads as roots. */
  rootsShowAt: Date | null
  /** Whichever comes first — the one that actually drives the rebook. */
  dueAt: Date | null
  /** Which of the two it is, so the salon knows what to say. */
  driver: 'TONE' | 'ROOTS' | null
  /** Weeks from the colour to `dueAt`, for the rebook nudge to anchor on. */
  intervalWeeks: number | null
  /** What would make this better, in the salon's language. Never a silent gap. */
  missing: string[]
  confidence: 'GOOD' | 'ROUGH' | 'NONE'
}

/**
 * How long the tone holds, before anything about this client is known.
 *
 * A toner sits on the outside of pre-lightened hair and rinses away; a
 * permanent tint is inside the cortex and leaves when the hair does. The gap
 * between them is the single biggest term in this whole model, which is why
 * getting the KIND right matters more than any lifestyle adjustment.
 */
const BASE_WEEKS: Record<ColourKind, number> = {
  TONER: 4,
  BLEACH_AND_TONE: 5,
  GLOSS: 5,
  PERMANENT: 8,
}

/** Washes a week the base figures assume. */
const BASELINE_WASHES = 3
/** Heat sessions a week the base figures assume. */
const BASELINE_HEAT = 3

/** Centimetres a month, averaged across adults. */
const AVERAGE_GROWTH_CM = 1.25
const WEEKS_PER_MONTH = 4.345

/**
 * How much regrowth reads as "roots", by how much contrast there is.
 *
 * A level 4 base under level 9 blonde announces itself at a centimetre. The
 * same centimetre on a level 6 wearing level 7 is invisible, and telling that
 * client to come back at six weeks is how a salon trains somebody to ignore it.
 */
const ROOT_THRESHOLD_CM = {
  high: 1.0,
  medium: 1.5,
  low: 2.5,
} as const

/**
 * Grey shows at the parting sooner than any contrast rule predicts, because it
 * is not a shade difference — it is a different texture catching the light.
 */
const GREY_THRESHOLD_CM = 1.0
const GREY_SHOWS_FROM_PERCENT = 30

const DAY_MS = 86_400_000

export function predictFade(input: FadeInputs, now = new Date()): FadePrediction {
  const missing: string[] = []

  if (input.colouredAt === null) missing.push('when their colour was last done')
  if (input.kind === null) missing.push('what kind of colour it was')
  if (input.naturalLevel === null) missing.push('their natural level')
  if (input.currentLevel === null) missing.push('the level they are wearing')
  if (input.washesPerWeek === null) missing.push('how often they wash it')

  /*
   * No date, no prediction. Everything else here degrades to an average; this
   * one has nothing to be an average of, and a date measured from "now" would
   * silently mean "however long ago you happened to open this screen".
   */
  if (input.colouredAt === null || input.kind === null) {
    return {
      toneFadesAt: null,
      rootsShowAt: null,
      dueAt: null,
      driver: null,
      intervalWeeks: null,
      missing,
      confidence: 'NONE',
    }
  }

  const toneWeeks = BASE_WEEKS[input.kind] * lifestyleFactor(input)
  const toneFadesAt = addWeeks(input.colouredAt, toneWeeks)

  const rootWeeks = weeksToVisibleRoots(input)
  const rootsShowAt = rootWeeks === null ? null : addWeeks(input.colouredAt, rootWeeks)

  const [dueAt, driver, intervalWeeks] =
    rootsShowAt !== null && rootWeeks !== null && rootWeeks < toneWeeks
      ? ([rootsShowAt, 'ROOTS' as const, rootWeeks] as const)
      : ([toneFadesAt, 'TONE' as const, toneWeeks] as const)

  return {
    toneFadesAt,
    rootsShowAt,
    dueAt,
    driver,
    intervalWeeks: Math.round(intervalWeeks * 10) / 10,
    missing,
    confidence: confidenceOf(input, now),
  }
}

/**
 * Everything the client does to it between visits, as one multiplier.
 *
 * Multiplicative and clamped, because these compound in reality — somebody who
 * washes daily AND swims AND straightens is not three separate small problems —
 * but an unclamped product of four terms produces a fortnight, which no
 * colourist would sign their name to.
 */
function lifestyleFactor(input: FadeInputs): number {
  let factor = 1

  if (input.washesPerWeek !== null) {
    // Roughly six per cent per wash either side of three a week.
    factor *= 1 - (input.washesPerWeek - BASELINE_WASHES) * 0.06
  }
  if (input.heatStylingPerWeek !== null && input.heatStylingPerWeek > BASELINE_HEAT) {
    factor *= 1 - (input.heatStylingPerWeek - BASELINE_HEAT) * 0.03
  }
  if (input.swimsChlorinatedWeekly) factor *= 0.8
  if (input.hardWater) factor *= 0.9
  // The one thing on this list that helps.
  if (input.usesPurpleShampoo) factor *= 1.1
  if (input.greyPercent !== null && input.greyPercent >= 50) factor *= 0.9

  return clamp(factor, 0.5, 1.4)
}

function weeksToVisibleRoots(input: FadeInputs): number | null {
  const growth = input.growthCmPerMonth ?? AVERAGE_GROWTH_CM
  if (growth <= 0) return null

  const threshold = rootThreshold(input)
  if (threshold === null) return null

  return threshold / (growth / WEEKS_PER_MONTH)
}

function rootThreshold(input: FadeInputs): number | null {
  if (input.greyPercent !== null && input.greyPercent >= GREY_SHOWS_FROM_PERCENT) {
    return GREY_THRESHOLD_CM
  }
  if (input.naturalLevel === null || input.currentLevel === null) return null

  const contrast = Math.abs(input.currentLevel - input.naturalLevel)
  if (contrast >= 4) return ROOT_THRESHOLD_CM.high
  if (contrast >= 2) return ROOT_THRESHOLD_CM.medium
  return ROOT_THRESHOLD_CM.low
}

/**
 * How much to trust it, said out loud.
 *
 * A date built entirely from averages is still worth showing — it beats the
 * salon's blanket six weeks — but it must not look like the same kind of
 * statement as one built from this client's own measurements.
 */
function confidenceOf(input: FadeInputs, now: Date): 'GOOD' | 'ROUGH' | 'NONE' {
  if (input.colouredAt === null) return 'NONE'

  /*
   * A colour from two years ago is a fact about history, not a basis for a
   * prediction. Somebody has been elsewhere, or has stopped colouring, and
   * projecting forward from it would put a due date in the past and dress it up
   * as advice.
   */
  const monthsAgo = (now.getTime() - input.colouredAt.getTime()) / (DAY_MS * 30.44)
  if (monthsAgo > 12) return 'NONE'

  const known =
    input.naturalLevel !== null &&
    input.currentLevel !== null &&
    input.washesPerWeek !== null &&
    input.growthCmPerMonth !== null

  return known ? 'GOOD' : 'ROUGH'
}

function addWeeks(from: Date, weeks: number): Date {
  return new Date(from.getTime() + weeks * 7 * DAY_MS)
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * What kind of colour a formula was, from what the stylist recorded.
 *
 * `FormulaPurpose` is the salon's own vocabulary and maps cleanly, which is the
 * whole reason this reads a formula rather than asking anybody a new question.
 */
export function colourKindOf(
  purpose: string,
  developerVolume: number | null,
): ColourKind | null {
  switch (purpose) {
    case 'TONER':
      return 'TONER'
    case 'GLOSS':
      return 'GLOSS'
    // Lightener is never the last thing on the hair — it is bleach, and what
    // fades is whatever was put over the top of it.
    case 'LIGHTENER':
      return 'BLEACH_AND_TONE'
    case 'GLOBAL_COLOR':
    case 'ROOT_TOUCH_UP':
    case 'LOWLIGHT':
      /*
       * Ten volume is a deposit-only formula whichever box the stylist ticked,
       * and it behaves like a gloss rather than a tint — it sits on the hair
       * instead of opening it.
       */
      return developerVolume !== null && developerVolume <= 10 ? 'GLOSS' : 'PERMANENT'
    /*
     * TREATMENT, PERM, RELAXER, SMOOTHING. Real services with real regrowth,
     * and no tone to lose — returning a colour kind for them would put a fade
     * date on a keratin treatment.
     */
    default:
      return null
  }
}
