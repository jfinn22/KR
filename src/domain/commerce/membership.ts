/**
 * Memberships: what they include, what they cost to change, and what happens
 * when the card stops working.
 *
 * Pure, and the reason is the same one that put pricing here rather than in a
 * service: this is the arithmetic somebody will one day be asked to justify to
 * a client who thinks they were charged twice. It has to be readable on its own
 * and testable without a database.
 *
 * The recurring theme is that a membership is a promise made in advance, and
 * every hard case here is what happens when circumstances change after the
 * promise. A salon that gets those wrong does not lose a subscription — it
 * loses the client, because being wrongly charged feels like being cheated.
 */

/** What a plan actually gives somebody. */
export interface Entitlement {
  /** The service it applies to, or null for anything. */
  serviceId: string | null
  /** Human wording, for the till and the client's own screen. */
  label: string
  kind: 'FREE' | 'PERCENT_OFF' | 'FIXED_OFF'
  /** Percent as basis points, fixed as cents. Ignored for FREE. */
  value: number
  /**
   * How many times per period. Null is unlimited.
   *
   * Unlimited is a real product — "as many blow-dries as you like" — and the
   * salons that sell it know exactly what they are doing. The type has to allow
   * it or they cannot express their own offer.
   */
  perPeriod: number | null
}

/**
 * Read a plan's entitlements out of the Json column they live in.
 *
 * Tolerant on purpose. `includedJson` is untyped, was in the schema before
 * anything wrote it, and will eventually contain something hand-edited — a
 * malformed entry drops out rather than taking the whole membership with it,
 * because a client standing at the till should not be told their membership
 * does not exist because somebody mistyped a number in an admin form.
 */
export function entitlementsOf(includedJson: unknown): Entitlement[] {
  if (!Array.isArray(includedJson)) return []

  return includedJson.flatMap((raw): Entitlement[] => {
    if (typeof raw !== 'object' || raw === null) return []
    const item = raw as Record<string, unknown>

    const kind = item.kind
    if (kind !== 'FREE' && kind !== 'PERCENT_OFF' && kind !== 'FIXED_OFF') return []

    const value = typeof item.value === 'number' && Number.isFinite(item.value) ? item.value : 0
    if (kind !== 'FREE' && value <= 0) return []

    return [
      {
        serviceId: typeof item.serviceId === 'string' ? item.serviceId : null,
        label: typeof item.label === 'string' && item.label !== '' ? item.label : 'Included',
        kind,
        value,
        perPeriod:
          typeof item.perPeriod === 'number' && item.perPeriod > 0
            ? Math.floor(item.perPeriod)
            : null,
      },
    ]
  })
}

export interface BillableLine {
  /** Which service this line is, where it is one. Retail has none. */
  serviceId: string | null
  description: string
  quantity: number
  unitPriceCents: number
}

export interface AppliedBenefit {
  lineIndex: number
  label: string
  discountCents: number
  /**
   * Which entitlement paid for it.
   *
   * Carried out rather than reconstructed by the caller, because the caller
   * would have to rebuild the same key from the same three fields — and the day
   * those two derivations drift is the day an allowance silently stops
   * resetting.
   */
  entitlementKey: string
}

/**
 * What the membership takes off this bill.
 *
 * Returns the reductions rather than a new set of lines, because the till has
 * to be able to show the client what they were charged AND what their
 * membership saved them. A membership that silently lowers a price looks like a
 * pricing error to the person paying, and the whole reason somebody keeps
 * paying a monthly fee is seeing it work.
 *
 * One benefit per line, best first. Stacking two entitlements on one haircut is
 * not something any salon means to sell, and the arithmetic for it — which
 * applies first, does the second apply to the reduced price — is a question
 * nobody has an answer to at the counter.
 */
export function applyEntitlements(
  lines: readonly BillableLine[],
  entitlements: readonly Entitlement[],
  /** How many of each entitlement the client has already used this period. */
  usedThisPeriod: Readonly<Record<string, number>> = {},
): AppliedBenefit[] {
  const used: Record<string, number> = { ...usedThisPeriod }
  const benefits: AppliedBenefit[] = []

  for (const [lineIndex, line] of lines.entries()) {
    const candidates = entitlements
      .filter((e) => e.serviceId === null || e.serviceId === line.serviceId)
      .filter((e) => e.perPeriod === null || (used[keyOf(e)] ?? 0) < e.perPeriod)
      .map((e) => ({ entitlement: e, discountCents: valueOf(e, line) }))
      .filter((c) => c.discountCents > 0)
      /*
       * Best for the client, not best for the salon. Somebody holding a
       * membership that could take either 20% or £10 off is entitled to the
       * larger, and a till that quietly picked the smaller would be taking
       * money from the person who prepaid for the privilege.
       */
      .sort((a, b) => b.discountCents - a.discountCents)

    const best = candidates[0]
    if (!best) continue

    used[keyOf(best.entitlement)] = (used[keyOf(best.entitlement)] ?? 0) + 1
    benefits.push({
      lineIndex,
      label: best.entitlement.label,
      discountCents: best.discountCents,
      entitlementKey: keyOf(best.entitlement),
    })
  }

  return benefits
}

function keyOf(entitlement: Entitlement): string {
  return `${entitlement.serviceId ?? '*'}:${entitlement.kind}:${entitlement.value}`
}

function valueOf(entitlement: Entitlement, line: BillableLine): number {
  const lineTotal = Math.round(line.unitPriceCents * line.quantity)
  switch (entitlement.kind) {
    case 'FREE':
      return lineTotal
    case 'PERCENT_OFF':
      return Math.round((lineTotal * entitlement.value) / 10_000)
    case 'FIXED_OFF':
      // Never more than the line is worth: a £30 benefit against a £20 service
      // is a £20 benefit, not £10 of credit the client can spend elsewhere.
      return Math.min(entitlement.value, lineTotal)
  }
}

// --- changing plan ----------------------------------------------------------

export interface Proration {
  /** Unused value of what they had, as a credit. */
  creditCents: number
  /** Cost of the new plan for the rest of this period. */
  chargeCents: number
  /** What actually moves. Negative means the salon owes them. */
  netCents: number
  /** Fraction of the period still to run, for anybody checking the sums. */
  remainingFraction: number
}

/**
 * Moving between plans partway through a period.
 *
 * Straight-line by elapsed time, which is the only method a client can check on
 * the back of an envelope — and being able to check it is the entire point. A
 * cleverer apportionment that nobody at the front desk can reproduce is a
 * conversation the salon loses.
 *
 * A downgrade produces a negative net, and this deliberately returns it rather
 * than clamping to zero. Whether the salon refunds the difference or carries it
 * as credit is a decision for the salon; hiding the number takes the decision
 * away and makes the client's arithmetic wrong.
 */
export function prorate(input: {
  oldPriceCents: number
  newPriceCents: number
  periodStart: Date
  periodEnd: Date
  at: Date
}): Proration {
  const total = input.periodEnd.getTime() - input.periodStart.getTime()
  if (total <= 0) {
    return { creditCents: 0, chargeCents: input.newPriceCents, netCents: input.newPriceCents, remainingFraction: 1 }
  }

  const elapsed = clamp(input.at.getTime() - input.periodStart.getTime(), 0, total)
  const remainingFraction = 1 - elapsed / total

  const creditCents = Math.round(input.oldPriceCents * remainingFraction)
  const chargeCents = Math.round(input.newPriceCents * remainingFraction)

  return {
    creditCents,
    chargeCents,
    netCents: chargeCents - creditCents,
    remainingFraction,
  }
}

// --- when the card stops working -------------------------------------------

export type DunningAction =
  /** Nothing yet — the provider is still retrying quietly. */
  | { stage: 'GRACE'; tellClient: false; suspend: false; cancel: false }
  /** Tell them. A card expires and nobody notices until they are refused. */
  | { stage: 'ASK'; tellClient: true; suspend: false; cancel: false }
  /** Benefits stop, the membership does not. */
  | { stage: 'SUSPEND'; tellClient: true; suspend: true; cancel: false }
  /** Over. */
  | { stage: 'CANCEL'; tellClient: true; suspend: true; cancel: true }

/** Days after the first failure at which each stage begins. */
export const DUNNING_DAYS = { ask: 1, suspend: 7, cancel: 21 } as const

/**
 * What to do about a payment that has not gone through.
 *
 * Three weeks before cancelling, and the length is the argument. Most failures
 * are an expired card on somebody who fully intends to keep paying, and a
 * membership cancelled at the first decline is a client who has to be re-sold
 * something they already wanted. But benefits stop at a week, because a
 * membership that keeps giving away haircuts to a card that does not work is
 * one the salon is paying for.
 */
export function dunningAction(firstFailedAt: Date, now: Date): DunningAction {
  const days = (now.getTime() - firstFailedAt.getTime()) / 86_400_000

  if (days >= DUNNING_DAYS.cancel) {
    return { stage: 'CANCEL', tellClient: true, suspend: true, cancel: true }
  }
  if (days >= DUNNING_DAYS.suspend) {
    return { stage: 'SUSPEND', tellClient: true, suspend: true, cancel: false }
  }
  if (days >= DUNNING_DAYS.ask) {
    return { stage: 'ASK', tellClient: true, suspend: false, cancel: false }
  }
  return { stage: 'GRACE', tellClient: false, suspend: false, cancel: false }
}

// --- revenue ----------------------------------------------------------------

export interface Recognition {
  /** Earned by `asOf`, because the period it covers has partly elapsed. */
  earnedCents: number
  /** Taken but not yet earned. A liability, not income. */
  deferredCents: number
}

/**
 * How much of a membership payment the salon has actually earned.
 *
 * A month's fee taken on the first is not a month's revenue on the first — it
 * is a promise to be available for thirty days, and a salon reading it as
 * income books a month it may still have to refund. Straight-line again, for
 * the same reason as proration: it has to be checkable.
 *
 * Reported beside the takings figure rather than replacing it. Deciding that
 * this platform's revenue moves from cash to accrual is a decision an owner
 * makes with their accountant, not one a release makes for them — but the part
 * of a membership month they have NOT earned is money in the bank they should
 * not be spending, and that is worth saying out loud either way.
 */
export function recogniseRevenue(input: {
  paidCents: number
  periodStart: Date
  periodEnd: Date
  asOf: Date
}): Recognition {
  const total = input.periodEnd.getTime() - input.periodStart.getTime()
  if (total <= 0) return { earnedCents: input.paidCents, deferredCents: 0 }

  const elapsed = clamp(input.asOf.getTime() - input.periodStart.getTime(), 0, total)
  const earnedCents = Math.round((input.paidCents * elapsed) / total)

  return { earnedCents, deferredCents: input.paidCents - earnedCents }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}
