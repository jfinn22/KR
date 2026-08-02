import type {
  ChemicalHistoryFact,
  ConsultationFacts,
  Density,
  Elasticity,
  LengthCategory,
  Level,
  Porosity,
  ScalpCondition,
  Sensitivity,
  ServiceFactSpec,
  SplitEnds,
  Texture,
} from './facts'

/**
 * Building the rules engine's input.
 *
 * The engine is a pure function of a frozen fact snapshot, which only works if
 * something assembles that snapshot honestly. This is that something: it takes
 * the client's answers, whatever the salon already knows about their hair, and
 * the catalog, and produces one `ConsultationFacts`.
 *
 * Pure — no database, no clock. The caller supplies today's date and the rows.
 *
 * Two principles run through it:
 *
 *  - **A client's answer beats a stale record.** If someone says they used box
 *    dye last month, that is now true regardless of what the chart said.
 *  - **Unknown is not the same as no.** A client who cannot remember when they
 *    last coloured their hair has not told us it never happened, and the engine
 *    treats those differently.
 */

export interface HairProfileLike {
  naturalLevel?: number | null
  currentLevelRoots?: number | null
  currentLevelMids?: number | null
  currentLevelEnds?: number | null
  texture?: string | null
  density?: string | null
  curlPattern?: string | null
  porosity?: string | null
  elasticity?: string | null
  integrityScore?: number | null
  lengthCategory?: string | null
  greyPercent?: number | null
  greyResistant?: boolean | null
  breakageReported?: boolean | null
  gumminessReported?: boolean | null
  sheddingReported?: boolean | null
  splitEnds?: string | null
  hasExtensions?: boolean | null
  extensionMethod?: string | null
  scalpCondition?: string | null
  scalpSensitivity?: string | null
  hasBoxDye?: boolean | null
  boxDyeLastAt?: Date | null
  boxDyeDarkOrBlack?: boolean | null
  hasHenna?: boolean | null
  hennaLastAt?: Date | null
  hennaProductKnown?: boolean | null
  hasBleach?: boolean | null
  bleachSessions12mo?: number | null
  bleachMaxLevelAchieved?: number | null
  hasKeratin?: boolean | null
  keratinLastAt?: Date | null
  hasRelaxer?: boolean | null
  relaxerLastAt?: Date | null
  hasPerm?: boolean | null
  permLastAt?: Date | null
  lastChemicalServiceAt?: Date | null
  allergiesJson?: unknown
  priorReactionToColor?: boolean | null
  isPregnantOrNursing?: boolean | null
  swimsChlorinatedWeekly?: boolean | null
  hardWater?: boolean | null
  heatStylingPerWeek?: number | null
  washesPerWeek?: number | null
  usesPurpleShampoo?: boolean | null
  maintenanceAppetite?: string | null
}

export interface NormalizeInput {
  /** Answer values keyed by question key. */
  answers: Readonly<Record<string, unknown>>
  /** questionKey → dotted fact path, from ConsultationQuestion.factKey. */
  factKeys: Readonly<Record<string, string>>
  hairProfile: HairProfileLike | null
  client: {
    /** Pseudonymous. Never a name — the engine has no use for one. */
    ref: string
    isMinor: boolean
    isNewToSalon: boolean
    priorNoShows: number
    priorCompletedVisits: number
  }
  services: readonly ServiceFactSpec[]
  stylist: {
    ref: string | null
    skills: Readonly<Record<string, number>>
    durationFactor: number
    calibrationSamples: number
  }
  compliance: {
    validPatchTestDaysRemaining: number | null
    guardianConsentOnFile: boolean
  }
  photos: {
    providedViews: readonly string[]
    requiredViews: readonly string[]
    lowestQualityScore: number | null
  }
  /** Injected — the normalizer never reads the clock. */
  today: Date
}

const MONTH_MS = 30 * 86_400_000

function monthsAgo(date: Date | null | undefined, today: Date): number | null {
  if (!date) return null
  const diff = (today.getTime() - date.getTime()) / MONTH_MS
  return diff < 0 ? 0 : Math.round(diff)
}

const bool = (value: unknown): boolean =>
  value === true || value === 'true' || value === 'yes' || value === 1 || value === '1'

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function level(value: unknown): Level | null {
  const parsed = num(value)
  if (parsed === null) return null
  const clamped = Math.min(10, Math.max(1, Math.round(parsed)))
  return clamped as Level
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const candidate = String(value ?? '').toUpperCase()
  return (allowed as readonly string[]).includes(candidate) ? (candidate as T) : fallback
}

/** Set a dotted path on a mutable draft. */
function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1]!] = value
}

function getPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((cursor, key) => {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    return (cursor as Record<string, unknown>)[key]
  }, source)
}

/**
 * Rebuild chemical history from the profile flags plus anything the client just
 * told us.
 *
 * `productKnown` is carried through deliberately: for henna it is the difference
 * between a caution and a blocker, because compound henna with metallic salts is
 * a genuine safety event and pure body-art henna is not.
 */
function buildHistory(
  profile: HairProfileLike | null,
  overrides: Record<string, unknown>,
  today: Date,
): ChemicalHistoryFact[] {
  const history: ChemicalHistoryFact[] = []

  const push = (
    kind: ChemicalHistoryFact['kind'],
    ever: boolean,
    last: Date | null | undefined,
    extra: Partial<ChemicalHistoryFact> = {},
  ) => {
    if (!ever) return
    history.push({
      kind,
      monthsAgo: monthsAgo(last, today),
      // An answered "yes" with no date is REPORTED, not UNKNOWN — the client
      // is sure it happened, just not when.
      certainty: last ? 'CONFIRMED' : 'REPORTED',
      appliedTo: ['MIDS', 'ENDS'],
      productKnown: true,
      source: 'CLIENT',
      ...extra,
    })
  }

  const answered = (path: string, fallback: boolean | null | undefined): boolean => {
    const value = getPath(overrides, path)
    return value === undefined ? Boolean(fallback) : bool(value)
  }

  push('BOX_DYE', answered('history.boxDye.ever', profile?.hasBoxDye), profile?.boxDyeLastAt, {
    appliedTo: profile?.boxDyeDarkOrBlack ? ['ALL'] : ['MIDS', 'ENDS'],
  })
  push('HENNA', answered('history.henna.ever', profile?.hasHenna), profile?.hennaLastAt, {
    productKnown: profile?.hennaProductKnown ?? false,
  })
  push('BLEACH', answered('history.bleach.ever', profile?.hasBleach), null)
  push('KERATIN', answered('history.keratin.ever', profile?.hasKeratin), profile?.keratinLastAt)
  push('RELAXER', answered('history.relaxer.ever', profile?.hasRelaxer), profile?.relaxerLastAt)
  push('PERM', answered('history.perm.ever', profile?.hasPerm), profile?.permLastAt)

  return history
}

export function normalizeFacts(input: NormalizeInput): ConsultationFacts {
  const profile = input.hairProfile

  // Map answers onto fact paths first, so a client's answer wins over the chart.
  const overrides: Record<string, unknown> = {}
  for (const [questionKey, factKey] of Object.entries(input.factKeys)) {
    const value = input.answers[questionKey]
    if (value === undefined || value === '') continue
    setPath(overrides, factKey, value)
  }

  const pick = <T>(path: string, fromProfile: T, transform: (v: unknown) => T): T => {
    const override = getPath(overrides, path)
    return override === undefined ? fromProfile : transform(override)
  }

  const history = buildHistory(profile, overrides, input.today)

  const missingRequiredViews = input.photos.requiredViews.filter(
    (view) => !input.photos.providedViews.includes(view),
  )

  const bleachEntry = history.find((h) => h.kind === 'BLEACH')

  return {
    factsVersion: 1,
    clientRef: input.client.ref,
    isMinor: input.client.isMinor,
    isNewToSalon: input.client.isNewToSalon,
    priorNoShows: input.client.priorNoShows,
    priorCompletedVisits: input.client.priorCompletedVisits,

    hair: {
      naturalLevel: pick(
        'hair.naturalLevel',
        (profile?.naturalLevel ?? null) as Level | null,
        level,
      ),
      currentLevel: {
        roots: pick(
          'hair.currentLevel.roots',
          (profile?.currentLevelRoots ?? null) as Level | null,
          level,
        ),
        mids: pick(
          'hair.currentLevel.mids',
          (profile?.currentLevelMids ?? null) as Level | null,
          level,
        ),
        ends: pick(
          'hair.currentLevel.ends',
          (profile?.currentLevelEnds ?? null) as Level | null,
          level,
        ),
      },
      lengthCategory: oneOf<LengthCategory>(
        getPath(overrides, 'hair.lengthCategory') ?? profile?.lengthCategory,
        ['PIXIE', 'CHIN', 'SHOULDER', 'COLLARBONE', 'MID_BACK', 'WAIST', 'HIP'],
        'SHOULDER',
      ),
      texture: oneOf<Texture>(
        getPath(overrides, 'hair.texture') ?? profile?.texture,
        ['FINE', 'MEDIUM', 'COARSE'],
        'MEDIUM',
      ),
      density: oneOf<Density>(
        getPath(overrides, 'hair.density') ?? profile?.density,
        ['LOW', 'MEDIUM', 'HIGH'],
        'MEDIUM',
      ),
      curlPattern: (profile?.curlPattern ?? null) as string | null,
      porosity: oneOf<Porosity>(
        getPath(overrides, 'hair.porosity') ?? profile?.porosity,
        ['LOW', 'NORMAL', 'HIGH'],
        'NORMAL',
      ),
      elasticity: oneOf<Elasticity>(
        getPath(overrides, 'hair.elasticity') ?? profile?.elasticity,
        ['POOR', 'FAIR', 'GOOD'],
        'GOOD',
      ),
      integrityScore: pick('hair.integrityScore', profile?.integrityScore ?? null, num),
      greyPercent: pick('hair.greyPercent', profile?.greyPercent ?? null, num),
      greyResistant: pick('hair.greyResistant', profile?.greyResistant ?? null, bool),
      breakageReported: pick('hair.breakageReported', Boolean(profile?.breakageReported), bool),
      gumminessReported: pick('hair.gumminessReported', Boolean(profile?.gumminessReported), bool),
      sheddingReported: pick('hair.sheddingReported', Boolean(profile?.sheddingReported), bool),
      splitEnds: oneOf<Uppercase<SplitEnds>>(
        getPath(overrides, 'hair.splitEnds') ?? profile?.splitEnds,
        ['NONE', 'SOME', 'SEVERE'],
        'NONE',
      ).toLowerCase() as SplitEnds,
      hasExtensions: Boolean(profile?.hasExtensions),
      extensionMethod: (profile?.extensionMethod ?? null) as string | null,
      scalpCondition: oneOf<ScalpCondition>(
        getPath(overrides, 'hair.scalpCondition') ?? profile?.scalpCondition,
        ['NORMAL', 'DRY', 'OILY', 'FLAKY', 'IRRITATED', 'PSORIASIS', 'ECZEMA'],
        'NORMAL',
      ),
      scalpSensitivity: oneOf<Sensitivity>(
        getPath(overrides, 'hair.scalpSensitivity') ?? profile?.scalpSensitivity,
        ['NONE', 'MILD', 'MODERATE', 'SEVERE'],
        'NONE',
      ),
    },

    history,
    lastChemicalServiceMonthsAgo: monthsAgo(profile?.lastChemicalServiceAt, input.today),

    health: {
      knownAllergies: normalizeAllergies(
        getPath(overrides, 'health.knownAllergies') ?? profile?.allergiesJson,
      ),
      priorReactionToColor: pick(
        'health.priorReactionToColor',
        Boolean(profile?.priorReactionToColor),
        bool,
      ),
      isPregnantOrNursing: pick(
        'health.isPregnantOrNursing',
        profile?.isPregnantOrNursing ?? null,
        bool,
      ),
    },

    lifestyle: {
      swimsChlorinatedWeekly: pick(
        'lifestyle.swimsChlorinatedWeekly',
        Boolean(profile?.swimsChlorinatedWeekly),
        bool,
      ),
      hardWater: pick('lifestyle.hardWater', Boolean(profile?.hardWater), bool),
      heatStylingPerWeek: pick(
        'lifestyle.heatStylingPerWeek',
        profile?.heatStylingPerWeek ?? 0,
        (v) => num(v) ?? 0,
      ),
      washesPerWeek: pick(
        'lifestyle.washesPerWeek',
        profile?.washesPerWeek ?? 3,
        (v) => num(v) ?? 3,
      ),
      usesPurpleShampoo: pick(
        'lifestyle.usesPurpleShampoo',
        Boolean(profile?.usesPurpleShampoo),
        bool,
      ),
      maintenanceAppetite: oneOf<'LOW' | 'MEDIUM' | 'HIGH'>(
        getPath(overrides, 'lifestyle.maintenanceAppetite') ?? profile?.maintenanceAppetite,
        ['LOW', 'MEDIUM', 'HIGH'],
        'MEDIUM',
      ),
      budgetBandCents: num(getPath(overrides, 'lifestyle.budgetBandCents')),
    },

    goal: {
      targetLevel: level(getPath(overrides, 'goal.targetLevel')),
      targetTone: (getPath(overrides, 'goal.targetTone') as string | null) ?? null,
      techniques: normalizeStringArray(getPath(overrides, 'goal.techniques')),
      wantsAllOver: bool(getPath(overrides, 'goal.wantsAllOver')),
      contrastPreference: normalizeContrast(getPath(overrides, 'goal.contrastPreference')),
      willingMultiSession: (() => {
        const value = getPath(overrides, 'goal.willingMultiSession')
        return value === undefined ? null : bool(value)
      })(),
      hardDeadlineDaysAway: normalizeDeadline(
        getPath(overrides, 'goal.hardDeadlineDaysAway'),
        input.today,
      ),
    },

    request: {
      services: input.services,
      stylistRef: input.stylist.ref,
      stylistSkills: input.stylist.skills,
      stylistDurationFactor: input.stylist.durationFactor,
      stylistCalibrationSamples: input.stylist.calibrationSamples,
    },

    compliance: input.compliance,

    photos: {
      providedViews: input.photos.providedViews,
      missingRequiredViews,
      lowestQualityScore: input.photos.lowestQualityScore,
    },
  }
}

function normalizeAllergies(value: unknown): ConsultationFacts['health']['knownAllergies'] {
  const allowed = ['PPD', 'AMMONIA', 'LATEX', 'FRAGRANCE', 'NICKEL', 'OTHER'] as const
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : typeof value === 'object' && value !== null && 'allergies' in value
        ? (((value as { allergies?: unknown }).allergies as unknown[]) ?? [])
        : []

  const normalized = raw
    .map((entry) => String(entry).trim().toUpperCase())
    .filter((entry): entry is (typeof allowed)[number] =>
      (allowed as readonly string[]).includes(entry),
    )

  return [...new Set(normalized)]
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).toUpperCase())
  if (typeof value === 'string' && value.length > 0) {
    return value.split(',').map((v) => v.trim().toUpperCase())
  }
  return []
}

function normalizeContrast(value: unknown): 'SUBTLE' | 'MEDIUM' | 'BOLD' | null {
  if (value === undefined || value === null || value === '') return null
  return oneOf<'SUBTLE' | 'MEDIUM' | 'BOLD'>(value, ['SUBTLE', 'MEDIUM', 'BOLD'], 'MEDIUM')
}

/** Accepts either a day count or a target date; both mean "how long have we got". */
function normalizeDeadline(value: unknown, today: Date): number | null {
  if (value === undefined || value === null || value === '') return null

  const asNumber = num(value)
  if (asNumber !== null && asNumber < 3650) return Math.max(0, Math.round(asNumber))

  const asDate = new Date(String(value))
  if (Number.isNaN(asDate.getTime())) return null
  return Math.max(0, Math.round((asDate.getTime() - today.getTime()) / 86_400_000))
}
