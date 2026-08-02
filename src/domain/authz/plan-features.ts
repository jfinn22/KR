/**
 * Plan tiers gate *features*; roles gate *actions*. The two are orthogonal —
 * an owner on Starter still cannot use multi-location, and a stylist on Salon
 * still cannot change billing.
 */

export type PlanCode = 'STARTER' | 'PRO' | 'SALON'

export const FEATURES = [
  'CONSULTATION_ENGINE',
  'RISK_DETECTION',
  'MULTI_SESSION_PLANNING',
  'FORMULA_HISTORY',
  'HAIR_TIMELINE',
  'DEPOSITS',
  'WAITLIST_AUTOFILL',
  'HOLD_MY_SPOT',
  'REBOOKING_AUTOMATION',
  'RETENTION_AUTOMATION',
  'ANALYTICS_BASIC',
  'ANALYTICS_ADVANCED',
  'QUOTE_ACCURACY',
  'CUSTOM_CONSULT_TEMPLATES',
  'RULE_CONFIGURATION',
  'AI_SUMMARIES',
  'AI_PHOTO_ANALYSIS',
  'AI_FORMULA_SUGGEST',
  'MULTI_LOCATION',
  'TEAM_DASHBOARDS',
  'SPECIALTY_ROUTING',
  'BRANDED_EXPERIENCE',
  'API_ACCESS',
  'PRIORITY_SUPPORT',
] as const

export type Feature = (typeof FEATURES)[number]

export interface PlanLimits {
  maxLocations: number
  maxStylists: number
  monthlySmsIncluded: number
  aiMonthlyCostCapMicros: number
  photoStorageGb: number
}

export interface PlanDefinition {
  code: PlanCode
  name: string
  tagline: string
  monthlyPriceCents: number
  yearlyPriceCents: number
  features: ReadonlySet<Feature>
  limits: PlanLimits
}

const STARTER_FEATURES: Feature[] = [
  'CONSULTATION_ENGINE',
  'HAIR_TIMELINE',
  'FORMULA_HISTORY',
  'ANALYTICS_BASIC',
]

const PRO_FEATURES: Feature[] = [
  ...STARTER_FEATURES,
  'RISK_DETECTION',
  'MULTI_SESSION_PLANNING',
  'DEPOSITS',
  'WAITLIST_AUTOFILL',
  'HOLD_MY_SPOT',
  'REBOOKING_AUTOMATION',
  'RETENTION_AUTOMATION',
  'QUOTE_ACCURACY',
  'CUSTOM_CONSULT_TEMPLATES',
  'AI_SUMMARIES',
]

const SALON_FEATURES: Feature[] = [
  ...PRO_FEATURES,
  'ANALYTICS_ADVANCED',
  'RULE_CONFIGURATION',
  'AI_PHOTO_ANALYSIS',
  'AI_FORMULA_SUGGEST',
  'MULTI_LOCATION',
  'TEAM_DASHBOARDS',
  'SPECIALTY_ROUTING',
  'BRANDED_EXPERIENCE',
  'API_ACCESS',
  'PRIORITY_SUPPORT',
]

export const PLANS: Record<PlanCode, PlanDefinition> = {
  STARTER: {
    code: 'STARTER',
    name: 'Starter',
    tagline: 'For solo stylists and booth renters',
    monthlyPriceCents: 2900,
    yearlyPriceCents: 29000,
    features: new Set(STARTER_FEATURES),
    limits: {
      maxLocations: 1,
      maxStylists: 1,
      monthlySmsIncluded: 200,
      aiMonthlyCostCapMicros: 0,
      photoStorageGb: 5,
    },
  },
  PRO: {
    code: 'PRO',
    name: 'Pro',
    tagline: 'For small salons that live and die by the colour book',
    monthlyPriceCents: 8900,
    yearlyPriceCents: 89000,
    features: new Set(PRO_FEATURES),
    limits: {
      maxLocations: 1,
      maxStylists: 8,
      monthlySmsIncluded: 1500,
      aiMonthlyCostCapMicros: 5_000_000,
      photoStorageGb: 50,
    },
  },
  SALON: {
    code: 'SALON',
    name: 'Salon',
    tagline: 'For multi-stylist and multi-location businesses',
    monthlyPriceCents: 19900,
    yearlyPriceCents: 199000,
    features: new Set(SALON_FEATURES),
    limits: {
      maxLocations: 25,
      maxStylists: 100,
      monthlySmsIncluded: 6000,
      aiMonthlyCostCapMicros: 25_000_000,
      photoStorageGb: 500,
    },
  },
}

export function hasFeature(plan: PlanCode, feature: Feature): boolean {
  return PLANS[plan].features.has(feature)
}

/** The cheapest plan that includes a feature — drives the upgrade prompt. */
export function minimumPlanFor(feature: Feature): PlanCode | null {
  for (const code of ['STARTER', 'PRO', 'SALON'] as const) {
    if (hasFeature(code, feature)) return code
  }
  return null
}

export function limitsFor(plan: PlanCode): PlanLimits {
  return PLANS[plan].limits
}

export class FeatureNotInPlanError extends Error {
  constructor(
    readonly feature: Feature,
    readonly currentPlan: PlanCode,
    readonly requiredPlan: PlanCode | null,
  ) {
    super(
      `Feature ${feature} is not included in the ${currentPlan} plan` +
        (requiredPlan ? ` — available from ${requiredPlan}` : ''),
    )
    this.name = 'FeatureNotInPlanError'
  }
}

export function requireFeature(plan: PlanCode, feature: Feature): void {
  if (!hasFeature(plan, feature)) {
    throw new FeatureNotInPlanError(feature, plan, minimumPlanFor(feature))
  }
}
