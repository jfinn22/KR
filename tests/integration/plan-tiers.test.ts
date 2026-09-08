import { describe, expect, it } from 'vitest'
import { FEATURES, PLANS, hasFeature, limitsFor } from '@/domain/authz/plan-features'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Whether the plan tiers mean anything.
 *
 * Twenty-four features were declared and exactly ONE of them — the branded
 * experience — was ever passed to `requireFeature`. So Starter, Pro and Salon
 * differed in price and in nothing else: a salon on the cheapest plan could
 * hold slots, run a waiting list, take deposits and issue API tokens exactly
 * like a salon paying seven times as much. That is the most expensive kind of
 * dead declaration in the whole codebase, because it is the pricing model.
 *
 * These tests are deliberately about the WIRING rather than about any one
 * feature: they fail when a tier stops being enforced anywhere, and when the
 * pricing page and the guard disagree about what a plan includes.
 */

const ACTION_FILES = ['booking.ts', 'commerce.ts', 'integrations.ts', 'retention.ts', 'settings.ts']

function actionSource(): string {
  return ACTION_FILES.map((f) =>
    readFileSync(join(process.cwd(), 'src/server/actions', f), 'utf8'),
  ).join('\n')
}

describe('the tiers actually gate something', () => {
  it('gates more than one feature, so a plan is not just a price', () => {
    const gated = new Set([...actionSource().matchAll(/feature: '([A-Z_]+)'/g)].map((m) => m[1]))

    // Not a count for its own sake: one gated feature is the state this test
    // exists to stop coming back.
    expect(gated.size).toBeGreaterThan(1)
    for (const feature of gated) {
      expect(FEATURES).toContain(feature)
    }
  })

  it('never gates on a feature every plan already has', () => {
    // A gate that Starter passes is not a gate. It would read as tiering in
    // the code and do nothing to a single customer.
    const gated = [...actionSource().matchAll(/feature: '([A-Z_]+)'/g)].map((m) => m[1])
    for (const feature of gated) {
      expect(hasFeature('STARTER', feature as never)).toBe(false)
    }
  })

  it('keeps the tiers strictly nested, which is what the pricing table draws', () => {
    // The pricing page renders one dot per cell and says nothing about a
    // feature being in Pro but not Salon. If that ever stopped being true the
    // table would quietly mislead.
    for (const feature of FEATURES) {
      if (hasFeature('STARTER', feature)) expect(hasFeature('PRO', feature)).toBe(true)
      if (hasFeature('PRO', feature)) expect(hasFeature('SALON', feature)).toBe(true)
    }
  })

  it('gives every tier a limit that is not smaller than the one below', () => {
    const starter = limitsFor('STARTER')
    const pro = limitsFor('PRO')
    const salon = limitsFor('SALON')
    for (const key of [
      'maxStylists',
      'maxLocations',
      'monthlySmsIncluded',
      'photoStorageGb',
    ] as const) {
      expect(pro[key]).toBeGreaterThanOrEqual(starter[key])
      expect(salon[key]).toBeGreaterThanOrEqual(pro[key])
    }
  })

  it('prices every tier above the one below, in both intervals', () => {
    expect(PLANS.PRO.monthlyPriceCents).toBeGreaterThan(PLANS.STARTER.monthlyPriceCents)
    expect(PLANS.SALON.monthlyPriceCents).toBeGreaterThan(PLANS.PRO.monthlyPriceCents)
    expect(PLANS.PRO.yearlyPriceCents).toBeGreaterThan(PLANS.STARTER.yearlyPriceCents)
    expect(PLANS.SALON.yearlyPriceCents).toBeGreaterThan(PLANS.PRO.yearlyPriceCents)
  })

  it('describes every feature on the pricing page', () => {
    /*
     * The page is generated from `PLANS`, but its labels are hand-written. A
     * feature added to the union with no label would render an empty row —
     * a blank line in a price list is worse than an absent one.
     */
    const page = readFileSync(join(process.cwd(), 'src/app/pricing/page.tsx'), 'utf8')
    for (const feature of FEATURES) {
      expect(page).toContain(`${feature}:`)
    }
  })
})
