import type {
  ChemicalHistoryFact,
  ConsultationFacts,
  Level,
  ServiceFactSpec,
} from '@/domain/consultation/facts'

/** A realistic balayage: active work, a processing gap, then the basin. */
export const BALAYAGE: ServiceFactSpec = {
  serviceId: 'svc_balayage',
  name: 'Full balayage',
  isChemical: true,
  isLightening: true,
  containsDye: false,
  isExtensionInstall: false,
  baseComplexity: 15,
  basePriceCents: 22000,
  requiredSkillCode: 'BALAYAGE',
  requiredSkillLevel: 3,
  phases: [
    { kind: 'ACTIVE', label: 'Application', durationMin: 90, isScalable: true },
    { kind: 'PROCESSING', label: 'Processing', durationMin: 40, isScalable: false },
    { kind: 'ACTIVE', label: 'Tone & finish', durationMin: 45, isScalable: true },
  ],
}

export const ROOT_TOUCH_UP: ServiceFactSpec = {
  serviceId: 'svc_root',
  name: 'Root touch-up',
  isChemical: true,
  isLightening: false,
  containsDye: true,
  isExtensionInstall: false,
  baseComplexity: 4,
  basePriceCents: 9000,
  requiredSkillCode: null,
  requiredSkillLevel: null,
  phases: [
    { kind: 'ACTIVE', label: 'Application', durationMin: 30, isScalable: false },
    { kind: 'PROCESSING', label: 'Processing', durationMin: 35, isScalable: false },
    { kind: 'ACTIVE', label: 'Rinse & blow-dry', durationMin: 25, isScalable: true },
  ],
}

export const TAPE_EXTENSIONS: ServiceFactSpec = {
  serviceId: 'svc_tape',
  name: 'Tape-in extensions',
  isChemical: false,
  isLightening: false,
  containsDye: false,
  isExtensionInstall: true,
  baseComplexity: 12,
  basePriceCents: 45000,
  requiredSkillCode: 'EXTENSIONS_TAPE',
  requiredSkillLevel: 3,
  phases: [{ kind: 'ACTIVE', label: 'Install', durationMin: 120, isScalable: true }],
}

export const DRY_CUT: ServiceFactSpec = {
  serviceId: 'svc_cut',
  name: 'Cut & finish',
  isChemical: false,
  isLightening: false,
  containsDye: false,
  isExtensionInstall: false,
  baseComplexity: 2,
  basePriceCents: 6500,
  requiredSkillCode: null,
  requiredSkillLevel: null,
  phases: [{ kind: 'ACTIVE', label: 'Cut & finish', durationMin: 45, isScalable: true }],
}

export function chem(
  kind: ChemicalHistoryFact['kind'],
  monthsAgo: number | null,
  overrides: Partial<ChemicalHistoryFact> = {},
): ChemicalHistoryFact {
  return {
    kind,
    monthsAgo,
    certainty: 'REPORTED',
    appliedTo: ['MIDS', 'ENDS'],
    productKnown: true,
    source: 'CLIENT',
    ...overrides,
  }
}

/**
 * A healthy, straightforward client. Every scenario in the suite starts here
 * and changes only the facts under test, so a failure points at one variable.
 */
export function baseFacts(overrides: DeepPartial<ConsultationFacts> = {}): ConsultationFacts {
  const base: ConsultationFacts = {
    factsVersion: 1,
    clientRef: 'ref_test',
    isMinor: false,
    isNewToSalon: false,
    priorNoShows: 0,
    priorCompletedVisits: 6,
    hair: {
      naturalLevel: 6 as Level,
      naturalTone: null,
      currentLevel: { roots: 6 as Level, mids: 6 as Level, ends: 6 as Level },
      lengthCategory: 'SHOULDER',
      texture: 'MEDIUM',
      density: 'MEDIUM',
      curlPattern: 'STRAIGHT',
      porosity: 'NORMAL',
      elasticity: 'GOOD',
      integrityScore: 8,
      greyPercent: 0,
      greyResistant: false,
      breakageReported: false,
      gumminessReported: false,
      sheddingReported: false,
      splitEnds: 'none',
      hasExtensions: false,
      extensionMethod: null,
      scalpCondition: 'NORMAL',
      scalpSensitivity: 'NONE',
    },
    history: [],
    lastChemicalServiceMonthsAgo: null,
    health: {
      knownAllergies: [],
      priorReactionToColor: false,
      isPregnantOrNursing: false,
    },
    lifestyle: {
      swimsChlorinatedWeekly: false,
      hardWater: false,
      heatStylingPerWeek: 2,
      washesPerWeek: 3,
      usesPurpleShampoo: false,
      maintenanceAppetite: 'MEDIUM',
      budgetBandCents: null,
    },
    goal: {
      targetLevel: null,
      targetTone: null,
      techniques: [],
      wantsAllOver: false,
      contrastPreference: null,
      willingMultiSession: true,
      hardDeadlineDaysAway: null,
    },
    request: {
      services: [DRY_CUT],
      stylistRef: 'sty_1',
      stylistSkills: { BALAYAGE: 5, EXTENSIONS_TAPE: 5 },
      stylistDurationFactor: 1,
      stylistCalibrationSamples: 0,
    },
    compliance: {
      validPatchTestDaysRemaining: 200,
      guardianConsentOnFile: false,
    },
    photos: {
      providedViews: ['FRONT', 'BACK', 'LEFT', 'RIGHT', 'ROOTS', 'MIDS', 'ENDS'],
      missingRequiredViews: [],
      lowestQualityScore: 0.9,
    },
  }

  return merge(base, overrides) as ConsultationFacts
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

function merge<T>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue
    const existing = out[k]
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      out[k] = merge(existing, v as never)
    } else {
      out[k] = v
    }
  }
  return out as T
}

export const TODAY = '2026-03-15'
