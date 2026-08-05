/**
 * ConsultationFacts — the rules engine's only input.
 *
 * A frozen, fully-normalised snapshot. No ids that require a lookup, no dates
 * that require a clock, no PII. Everything the engine needs is here, which is
 * what makes an evaluation reproducible a year later from the stored snapshot.
 */

export type Level = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export type LengthCategory =
  'PIXIE' | 'CHIN' | 'SHOULDER' | 'COLLARBONE' | 'MID_BACK' | 'WAIST' | 'HIP'

export type Texture = 'FINE' | 'MEDIUM' | 'COARSE'
export type Density = 'LOW' | 'MEDIUM' | 'HIGH'
export type Porosity = 'LOW' | 'NORMAL' | 'HIGH'
export type Elasticity = 'POOR' | 'FAIR' | 'GOOD'
export type SplitEnds = 'none' | 'some' | 'severe'
export type Sensitivity = 'NONE' | 'MILD' | 'MODERATE' | 'SEVERE'
export type ScalpCondition =
  'NORMAL' | 'DRY' | 'OILY' | 'FLAKY' | 'IRRITATED' | 'PSORIASIS' | 'ECZEMA'

export type Allergen = 'PPD' | 'AMMONIA' | 'LATEX' | 'FRAGRANCE' | 'NICKEL' | 'OTHER'

export type ChemicalKind =
  | 'BOX_DYE'
  | 'SALON_COLOR'
  | 'BLEACH'
  | 'HENNA'
  | 'KERATIN'
  | 'RELAXER'
  | 'PERM'
  | 'TONER'
  | 'COLOR_REMOVER'

export type HairZone = 'ROOTS' | 'MIDS' | 'ENDS' | 'ALL'

export interface ChemicalHistoryFact {
  kind: ChemicalKind
  /** null means "the client cannot remember when" — treated as unknown, not never. */
  monthsAgo: number | null
  certainty: 'CONFIRMED' | 'REPORTED' | 'SUSPECTED' | 'UNKNOWN'
  appliedTo: readonly HairZone[]
  /** Decisive for henna: pure body-art henna behaves very differently to compound. */
  productKnown: boolean
  source: 'CLIENT' | 'STYLIST' | 'RECORD'
}

/** The catalog snapshot for one requested service, frozen into the facts. */
export interface ServiceFactSpec {
  serviceId: string
  name: string
  isChemical: boolean
  isLightening: boolean
  containsDye: boolean
  isExtensionInstall: boolean
  baseComplexity: number
  basePriceCents: number
  requiredSkillCode: string | null
  requiredSkillLevel: number | null
  phases: readonly {
    kind: 'ACTIVE' | 'PROCESSING' | 'RINSE' | 'CONSULT'
    label: string
    durationMin: number
    isScalable: boolean
  }[]
}

export interface ConsultationFacts {
  readonly factsVersion: 1
  /** Pseudonymous. Never a name, email or phone — the engine has no use for them. */
  readonly clientRef: string
  readonly isMinor: boolean
  readonly isNewToSalon: boolean
  readonly priorNoShows: number
  readonly priorCompletedVisits: number

  readonly hair: {
    naturalLevel: Level | null
    /** Shade key from the chart — the tone the depth sits at, e.g. ash vs golden. */
    naturalTone: string | null
    currentLevel: { roots: Level | null; mids: Level | null; ends: Level | null }
    lengthCategory: LengthCategory
    texture: Texture
    density: Density
    curlPattern: string | null
    porosity: Porosity
    elasticity: Elasticity
    integrityScore: number | null
    greyPercent: number | null
    greyResistant: boolean | null
    breakageReported: boolean
    gumminessReported: boolean
    sheddingReported: boolean
    splitEnds: SplitEnds
    hasExtensions: boolean
    extensionMethod: string | null
    scalpCondition: ScalpCondition
    scalpSensitivity: Sensitivity
  }

  readonly history: readonly ChemicalHistoryFact[]
  readonly lastChemicalServiceMonthsAgo: number | null

  readonly health: {
    knownAllergies: readonly Allergen[]
    priorReactionToColor: boolean
    isPregnantOrNursing: boolean | null
  }

  readonly lifestyle: {
    swimsChlorinatedWeekly: boolean
    hardWater: boolean
    heatStylingPerWeek: number
    washesPerWeek: number
    usesPurpleShampoo: boolean
    maintenanceAppetite: 'LOW' | 'MEDIUM' | 'HIGH'
    budgetBandCents: number | null
  }

  readonly goal: {
    targetLevel: Level | null
    targetTone: string | null
    techniques: readonly string[]
    wantsAllOver: boolean
    contrastPreference: 'SUBTLE' | 'MEDIUM' | 'BOLD' | null
    willingMultiSession: boolean | null
    /** A wedding in three weeks changes which plans are honest to offer. */
    hardDeadlineDaysAway: number | null
  }

  readonly request: {
    services: readonly ServiceFactSpec[]
    stylistRef: string | null
    stylistSkills: Readonly<Record<string, number>>
    /** Data in, not a lookup — preserves engine purity. */
    stylistDurationFactor: number
    stylistCalibrationSamples: number
  }

  readonly compliance: {
    /** null = none on file. <= 0 = expired. */
    validPatchTestDaysRemaining: number | null
    guardianConsentOnFile: boolean
  }

  readonly photos: {
    providedViews: readonly string[]
    missingRequiredViews: readonly string[]
    lowestQualityScore: number | null
  }
}

// --- Small helpers rules use constantly ------------------------------------

/** Most recent occurrence of a chemical kind, in months. Infinity if never. */
export function monthsSince(facts: ConsultationFacts, kind: ChemicalKind): number {
  const entries = facts.history.filter((h) => h.kind === kind)
  if (entries.length === 0) return Infinity
  // An unremembered date is not "never" — treat it as long ago but present.
  return Math.min(...entries.map((h) => h.monthsAgo ?? 240))
}

/**
 * The same question, answered honestly.
 *
 * `monthsSince` has two sentinels and neither is null: `Infinity` when the kind
 * never occurred, and 240 when it did but nobody remembers when. Both are
 * deliberate — a rule asking "within 12 months?" wants a number it can compare,
 * and 240 correctly means "not recently" for something that definitely happened.
 *
 * They are exactly wrong for anything doing arithmetic FORWARD. A fade
 * prediction multiplying by elapsed weeks turns `Infinity` into a date that
 * does not exist and 240 into one twenty years out, and both render as
 * confident advice. Anything projecting from a date needs to be able to tell
 * "we do not know" from "a long time ago", so it gets its own accessor rather
 * than a caller remembering to check for two magic numbers.
 */
export function monthsSinceOrNull(facts: ConsultationFacts, kind: ChemicalKind): number | null {
  const entries = facts.history.filter((h) => h.kind === kind)
  if (entries.length === 0) return null

  const known = entries.flatMap((h) => (h.monthsAgo === null ? [] : [h.monthsAgo]))
  return known.length === 0 ? null : Math.min(...known)
}

export function occurrencesOf(
  facts: ConsultationFacts,
  kind: ChemicalKind,
): readonly ChemicalHistoryFact[] {
  return facts.history.filter((h) => h.kind === kind)
}

export function appliedToLengths(entries: readonly ChemicalHistoryFact[]): boolean {
  return entries.some((h) => h.appliedTo.some((z) => z === 'MIDS' || z === 'ENDS' || z === 'ALL'))
}

/** The level lightening actually starts from — the darkest relevant zone. */
export function startingLevel(facts: ConsultationFacts): Level {
  const { mids, ends, roots } = facts.hair.currentLevel
  return mids ?? ends ?? roots ?? facts.hair.naturalLevel ?? 5
}

/** Levels of lift requested. Zero when there is no lightening goal. */
export function requestedLift(facts: ConsultationFacts): number {
  if (facts.goal.targetLevel == null) return 0
  return Math.max(0, facts.goal.targetLevel - startingLevel(facts))
}

export function wantsLightening(facts: ConsultationFacts): boolean {
  return facts.request.services.some((s) => s.isLightening)
}

export function wantsDye(facts: ConsultationFacts): boolean {
  return facts.request.services.some((s) => s.containsDye)
}

export function wantsExtensions(facts: ConsultationFacts): boolean {
  return facts.request.services.some((s) => s.isExtensionInstall)
}

export function hasValidPatchTest(facts: ConsultationFacts): boolean {
  const d = facts.compliance.validPatchTestDaysRemaining
  return d !== null && d > 0
}
