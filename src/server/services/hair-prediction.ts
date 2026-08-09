import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import { colourKindOf, predictFade, type FadeInputs, type FadePrediction } from '@/domain/hair/fade'

/**
 * When this client needs to be back, from what the salon already knows.
 *
 * Assembled from the real tables rather than from `ConsultationFacts`, and that
 * is the architectural decision worth stating. Facts are a frozen snapshot the
 * rules engine replays — feeding a new input through them means bumping
 * `factsVersion`, which is a versioned migration of every stored evaluation
 * rather than a feature. Fade is not a rule about whether the service is safe.
 * It is arithmetic about hair that has already been coloured, so it reads the
 * hair record directly and leaves the engine alone.
 *
 * The date it works from is the appointment, never the formula's `createdAt`.
 * A formula is written up whenever the stylist gets a minute, and an imported
 * one is stamped at migration — using it would read a whole salon as having
 * been coloured on the day they switched platforms.
 */

export interface PredictionForClient extends FadePrediction {
  /** What the prediction was built from, so a stylist can disagree with it. */
  basis: {
    colouredAt: Date | null
    kind: FadeInputs['kind']
    naturalLevel: number | null
    currentLevel: number | null
    growthCmPerMonth: number | null
    /** True when the growth figure is the population average, not this client. */
    growthIsAverage: boolean
  }
}

export async function predictionFor(
  salonId: string,
  clientProfileId: string,
  now = new Date(),
): Promise<PredictionForClient> {
  const db = dbFor(salonId)

  const [profile, lastColour] = await Promise.all([
    db.hairProfile.findFirst({
      where: { salonId, clientProfileId },
      select: {
        naturalLevel: true,
        currentLevelRoots: true,
        currentLevelMids: true,
        greyPercent: true,
        washesPerWeek: true,
        heatStylingPerWeek: true,
        swimsChlorinatedWeekly: true,
        usesPurpleShampoo: true,
        hardWater: true,
        growthCmPerMonth: true,
        salonColorLastAt: true,
        tonerLastAt: true,
      },
    }),
    /*
     * The most recent colour formula, dated by its appointment.
     *
     * Ordered on the appointment rather than the formula, because that is the
     * day the colour went on — and a formula with no appointment is a template
     * or a note, not a service somebody had.
     */
    db.formula.findFirst({
      where: {
        salonId,
        clientProfileId,
        isTemplate: false,
        appointmentId: { not: null },
        purpose: { in: ['GLOBAL_COLOR', 'ROOT_TOUCH_UP', 'LIGHTENER', 'TONER', 'GLOSS', 'LOWLIGHT'] },
      },
      orderBy: { appointment: { startsAt: 'desc' } },
      select: {
        purpose: true,
        developerVolume: true,
        appointment: { select: { startsAt: true, status: true } },
      },
    }),
  ])

  /*
   * A booked-but-not-attended appointment is not a colour that happened. Using
   * it would start the clock on a visit the client cancelled.
   */
  const attended =
    lastColour?.appointment?.status === 'COMPLETED' ? lastColour.appointment.startsAt : null

  /*
   * The formula's own appointment first, the profile's recorded date second.
   * The formula knows what KIND it was, which the profile date cannot say — so
   * a profile-only date is a permanent colour by assumption, and says so
   * through its confidence rather than by pretending to know.
   */
  const colouredAt = attended ?? profile?.salonColorLastAt ?? null
  const kind = attended
    ? colourKindOf(lastColour!.purpose, lastColour!.developerVolume)
    : colouredAt
      ? 'PERMANENT'
      : null

  const growthCmPerMonth =
    profile?.growthCmPerMonth === null || profile?.growthCmPerMonth === undefined
      ? null
      : Number(profile.growthCmPerMonth)

  const inputs: FadeInputs = {
    colouredAt,
    kind,
    naturalLevel: profile?.naturalLevel ?? null,
    // What they are actually wearing at the root is what regrows against.
    currentLevel: profile?.currentLevelRoots ?? profile?.currentLevelMids ?? null,
    greyPercent: profile?.greyPercent ?? null,
    washesPerWeek: profile?.washesPerWeek ?? null,
    heatStylingPerWeek: profile?.heatStylingPerWeek ?? null,
    swimsChlorinatedWeekly: profile?.swimsChlorinatedWeekly ?? false,
    usesPurpleShampoo: profile?.usesPurpleShampoo ?? false,
    hardWater: profile?.hardWater ?? false,
    growthCmPerMonth,
  }

  return {
    ...predictFade(inputs, now),
    basis: {
      colouredAt,
      kind,
      naturalLevel: inputs.naturalLevel,
      currentLevel: inputs.currentLevel,
      growthCmPerMonth,
      growthIsAverage: growthCmPerMonth === null,
    },
  }
}

/**
 * What a stylist can tell the platform about hair between visits.
 *
 * The missing half of `HairProfile`. Every field on it is read somewhere and
 * exactly one — `priorReactionToColor` — was ever written by the application,
 * so the rest have sat at their defaults since the schema was created. A
 * prediction fed entirely by defaults is a prediction about nobody.
 */
export interface HairProfileUpdate {
  naturalLevel?: number | null
  currentLevelRoots?: number | null
  greyPercent?: number | null
  washesPerWeek?: number | null
  heatStylingPerWeek?: number | null
  swimsChlorinatedWeekly?: boolean
  usesPurpleShampoo?: boolean
  hardWater?: boolean
  growthCmPerMonth?: number | null
  salonColorLastAt?: Date | null
  tonerLastAt?: Date | null
  bleachLastAt?: Date | null
}

export async function updateHairProfile(
  salonId: string,
  clientProfileId: string,
  update: HairProfileUpdate,
): Promise<void> {
  const db = dbFor(salonId)
  const client = await db.clientProfile.findFirst({
    where: { id: clientProfileId, salonId },
    select: { id: true },
  })
  if (!client) throw new DomainError('NOT_FOUND', 'That client is not here.')

  /*
   * Upsert, because plenty of clients have never had a consultation and so have
   * no profile row — and the desk should be able to write down what somebody
   * says about their hair without starting a consultation to do it.
   */
  await db.hairProfile.upsert({
    where: { clientProfileId },
    create: { salonId, clientProfileId, ...cleaned(update) },
    update: cleaned(update),
  })
}

/**
 * Record that a colour happened, from the appointment that did it.
 *
 * Called when a colour formula is saved, so the profile's own dates stay true
 * without anybody typing them twice. `hasSalonColor` and the date are what the
 * history array reads, and the history array is what had nothing in it.
 */
export async function noteColourApplied(
  salonId: string,
  clientProfileId: string,
  input: { at: Date; purpose: string; developerVolume: number | null },
): Promise<void> {
  const db = dbFor(salonId)
  const kind = colourKindOf(input.purpose, input.developerVolume)
  if (kind === null) return

  const data =
    kind === 'TONER'
      ? { tonerLastAt: input.at }
      : kind === 'BLEACH_AND_TONE'
        ? { bleachLastAt: input.at, hasBleach: true, salonColorLastAt: input.at, hasSalonColor: true }
        : { salonColorLastAt: input.at, hasSalonColor: true }

  await db.hairProfile.upsert({
    where: { clientProfileId },
    create: { salonId, clientProfileId, ...data, lastChemicalServiceAt: input.at },
    update: { ...data, lastChemicalServiceAt: input.at },
  })
}

function cleaned(update: HairProfileUpdate): Record<string, unknown> {
  // `undefined` means "not on the form"; `null` means "clear it". Prisma treats
  // undefined as absent, so only the second needs any care.
  return Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined))
}
