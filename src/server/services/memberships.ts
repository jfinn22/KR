import { unsafeDb } from '@/server/db/client'
import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import { paymentsPort } from '@/ports/registry'
import { materialiseNotification } from './notifications'
import {
  applyEntitlements,
  dunningAction,
  entitlementsOf,
  prorate,
  type AppliedBenefit,
  type BillableLine,
  type Entitlement,
} from '@/domain/commerce/membership'

/**
 * Selling the same client the same thing every month.
 *
 * Ten schema models have described memberships since the beginning and nothing
 * has ever created one. The models were the easy tenth; this is the machinery —
 * and almost all of it is about what happens AFTER the sale, because that is
 * where a subscription business is either trustworthy or not.
 *
 * The rule underneath every decision here: a membership is a promise made in
 * advance, and the client has already paid for it. Where the salon and the
 * client could each reasonably read a situation differently, this reads it the
 * client's way — the better of two benefits, the rest of a period somebody has
 * cancelled, three weeks before giving up on a card. A salon that wins those
 * arguments loses the client.
 */

const PERIOD_MS = { MONTH: 30 * 86_400_000, YEAR: 365 * 86_400_000 } as const

export interface MembershipView {
  id: string
  planId: string
  planName: string
  priceCents: number
  status: string
  currentPeriodStart: Date | null
  renewsAt: Date | null
  cancelAtPeriodEnd: boolean
  pastDueSince: Date | null
  entitlements: Entitlement[]
  /** How many of each benefit are gone this period. */
  usedThisPeriod: Record<string, number>
  /** True when benefits are withheld — past due long enough to suspend. */
  suspended: boolean
}

/**
 * The client's membership, if they have a live one.
 *
 * `CANCELLED` is excluded and `PAUSED` is not: a paused membership is one the
 * salon stopped deliberately, and whether its benefits still apply is a
 * question for the salon rather than something to answer by omission. It comes
 * back with `suspended` set so the till can say so.
 */
export async function membershipFor(
  salonId: string,
  clientProfileId: string,
  now = new Date(),
): Promise<MembershipView | null> {
  const db = dbFor(salonId)

  const membership = await db.clientMembership.findFirst({
    where: { salonId, clientProfileId, status: { in: ['ACTIVE', 'PAST_DUE', 'PAUSED'] } },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      planId: true,
      status: true,
      currentPeriodStart: true,
      renewsAt: true,
      cancelAtPeriodEnd: true,
      pastDueSince: true,
      plan: { select: { name: true, priceCents: true, includedJson: true } },
    },
  })
  if (!membership) return null

  const periodStart = membership.currentPeriodStart ?? new Date(0)
  const uses = await db.membershipBenefitUse.groupBy({
    by: ['entitlementKey'],
    where: { salonId, membershipId: membership.id, periodStart },
    _count: { _all: true },
  })

  const suspended =
    membership.status === 'PAUSED' ||
    (membership.pastDueSince !== null && dunningAction(membership.pastDueSince, now).suspend)

  return {
    id: membership.id,
    planId: membership.planId,
    planName: membership.plan.name,
    priceCents: membership.plan.priceCents,
    status: membership.status,
    currentPeriodStart: membership.currentPeriodStart,
    renewsAt: membership.renewsAt,
    cancelAtPeriodEnd: membership.cancelAtPeriodEnd,
    pastDueSince: membership.pastDueSince,
    entitlements: entitlementsOf(membership.plan.includedJson),
    usedThisPeriod: Object.fromEntries(uses.map((u) => [u.entitlementKey, u._count._all])),
    suspended,
  }
}

export interface BenefitsForBill {
  membershipId: string
  planName: string
  benefits: AppliedBenefit[]
  totalCents: number
  /** Set when a membership exists but is not paying out, so the till can say so. */
  withheldReason: string | null
}

/**
 * What this client's membership takes off this bill.
 *
 * Computed at the till rather than stored on the plan, because the answer
 * depends on what else they have already had this period — and because a
 * benefit the client can watch being applied is the reason they keep paying the
 * fee. A membership that silently lowers a price reads as a pricing error to
 * the person paying.
 */
export async function benefitsForBill(
  salonId: string,
  clientProfileId: string,
  lines: readonly BillableLine[],
  now = new Date(),
): Promise<BenefitsForBill | null> {
  const membership = await membershipFor(salonId, clientProfileId, now)
  if (!membership) return null

  if (membership.suspended) {
    return {
      membershipId: membership.id,
      planName: membership.planName,
      benefits: [],
      totalCents: 0,
      withheldReason:
        membership.status === 'PAUSED'
          ? 'Their membership is paused.'
          : 'Their membership payment has not gone through.',
    }
  }

  const benefits = applyEntitlements(lines, membership.entitlements, membership.usedThisPeriod)

  return {
    membershipId: membership.id,
    planName: membership.planName,
    benefits,
    totalCents: benefits.reduce((total, benefit) => total + benefit.discountCents, 0),
    withheldReason: null,
  }
}

/**
 * Write down that the benefits were used, once the bill is real.
 *
 * Separate from computing them, because a till recalculates a bill every time
 * somebody adds a line — and counting an allowance against a bill nobody paid
 * would use up a client's free cut while they were still deciding.
 */
export async function recordBenefitUse(input: {
  salonId: string
  membershipId: string
  invoiceId: string
  benefits: readonly AppliedBenefit[]
  now?: Date
}): Promise<void> {
  if (input.benefits.length === 0) return

  const membership = await unsafeDb.clientMembership.findFirst({
    where: { id: input.membershipId, salonId: input.salonId },
    select: { currentPeriodStart: true },
  })
  if (!membership) return

  await unsafeDb.membershipBenefitUse.createMany({
    data: input.benefits.map((benefit) => ({
      salonId: input.salonId,
      membershipId: input.membershipId,
      invoiceId: input.invoiceId,
      entitlementKey: benefit.entitlementKey,
      label: benefit.label,
      discountCents: benefit.discountCents,
      periodStart: membership.currentPeriodStart ?? new Date(0),
    })),
  })
}

/** Give an allowance back when the invoice it was used on is voided. */
export async function releaseBenefitUse(salonId: string, invoiceId: string): Promise<void> {
  await unsafeDb.membershipBenefitUse.deleteMany({ where: { salonId, invoiceId } })
}

// --- selling one ------------------------------------------------------------

/**
 * Start a membership.
 *
 * Requires a card already on file. A subscription with no way to collect the
 * second payment is a membership that fails at the end of the first month and
 * takes the client's goodwill with it — better to refuse at the counter, where
 * somebody can hand over a card.
 */
export async function subscribeClient(input: {
  salonId: string
  clientProfileId: string
  planId: string
  now?: Date
}): Promise<{ membershipId: string }> {
  const now = input.now ?? new Date()
  const db = dbFor(input.salonId)

  const [plan, existing, client] = await Promise.all([
    db.clientMembershipPlan.findFirst({
      where: { id: input.planId, salonId: input.salonId, isActive: true },
      select: { id: true, priceCents: true, interval: true, stripePriceId: true },
    }),
    db.clientMembership.findFirst({
      where: {
        salonId: input.salonId,
        clientProfileId: input.clientProfileId,
        status: { in: ['ACTIVE', 'PAST_DUE'] },
      },
      select: { id: true },
    }),
    db.clientProfile.findFirst({
      where: { id: input.clientProfileId, salonId: input.salonId },
      select: { id: true, email: true, firstName: true, lastName: true, paymentsCustomerRef: true },
    }),
  ])

  if (!plan) throw new DomainError('NOT_FOUND', 'That plan is not available.')
  if (!client) throw new DomainError('NOT_FOUND', 'That client is not here.')
  if (existing) {
    throw new DomainError('CONFLICT', 'They are already on a membership. Change it instead.')
  }
  if (!client.paymentsCustomerRef) {
    throw new DomainError(
      'INVALID_INPUT',
      'They need a card on file first — a membership with no way to take the second payment is one that fails next month.',
    )
  }

  /*
   * The provider is told only where the salon has configured a price for this
   * plan. A salon running memberships as an arrangement rather than a
   * subscription — plenty do, on account — should not be blocked from selling
   * one because nobody set up a price id.
   */
  let stripeSubscriptionId: string | null = null
  let renewsAt = new Date(now.getTime() + periodOf(plan.interval))

  if (plan.stripePriceId) {
    const result = await paymentsPort().createSubscription({
      customerRef: client.paymentsCustomerRef,
      priceId: plan.stripePriceId,
      idempotencyKey: `sub:${input.salonId}:${input.clientProfileId}:${plan.id}`,
    })
    stripeSubscriptionId = result.id
    renewsAt = new Date(result.currentPeriodEnd)
  }

  const membership = await db.clientMembership.create({
    data: {
      salonId: input.salonId,
      clientProfileId: input.clientProfileId,
      planId: plan.id,
      status: 'ACTIVE',
      startedAt: now,
      currentPeriodStart: now,
      renewsAt,
      stripeSubscriptionId,
    },
    select: { id: true },
  })

  return { membershipId: membership.id }
}

/**
 * Stop it.
 *
 * At the end of the period by default, because somebody who cancels on the 3rd
 * has bought the rest of the month and is entitled to it. Ending it the moment
 * they click is taking money for a service withdrawn, and it is the single
 * thing that makes people distrust subscriptions.
 */
export async function cancelMembership(input: {
  salonId: string
  membershipId: string
  immediately?: boolean
  now?: Date
}): Promise<{ endsAt: Date | null }> {
  const now = input.now ?? new Date()
  const db = dbFor(input.salonId)

  const membership = await db.clientMembership.findFirst({
    where: { id: input.membershipId, salonId: input.salonId },
    select: { id: true, renewsAt: true, status: true },
  })
  if (!membership) throw new DomainError('NOT_FOUND', 'That membership is not here.')
  if (membership.status === 'CANCELLED') {
    throw new DomainError('CONFLICT', 'That membership has already ended.')
  }

  if (input.immediately) {
    await db.clientMembership.update({
      where: { id: membership.id },
      data: { status: 'CANCELLED', cancelledAt: now, cancelAtPeriodEnd: false },
    })
    return { endsAt: now }
  }

  await db.clientMembership.update({
    where: { id: membership.id },
    data: { cancelAtPeriodEnd: true },
  })
  return { endsAt: membership.renewsAt }
}

/**
 * Move to a different plan, with the difference worked out.
 *
 * The proration is returned as well as applied, so the person at the counter
 * can read the client the two numbers it came from. "You have £15 left on the
 * old one and the new one is £25 for the rest of the month" is a conversation;
 * "that will be £10" is a dispute waiting to happen.
 */
export async function changePlan(input: {
  salonId: string
  membershipId: string
  newPlanId: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const db = dbFor(input.salonId)

  const [membership, newPlan] = await Promise.all([
    db.clientMembership.findFirst({
      where: { id: input.membershipId, salonId: input.salonId },
      select: {
        id: true,
        status: true,
        currentPeriodStart: true,
        renewsAt: true,
        plan: { select: { id: true, priceCents: true, interval: true } },
      },
    }),
    db.clientMembershipPlan.findFirst({
      where: { id: input.newPlanId, salonId: input.salonId, isActive: true },
      select: { id: true, priceCents: true, interval: true },
    }),
  ])

  if (!membership) throw new DomainError('NOT_FOUND', 'That membership is not here.')
  if (!newPlan) throw new DomainError('NOT_FOUND', 'That plan is not available.')
  if (membership.plan.id === newPlan.id) {
    throw new DomainError('CONFLICT', 'They are already on that plan.')
  }
  if (membership.status === 'CANCELLED') {
    throw new DomainError('CONFLICT', 'That membership has already ended.')
  }

  const periodStart = membership.currentPeriodStart ?? now
  const periodEnd = membership.renewsAt ?? new Date(periodStart.getTime() + periodOf(newPlan.interval))

  const proration = prorate({
    oldPriceCents: membership.plan.priceCents,
    newPriceCents: newPlan.priceCents,
    periodStart,
    periodEnd,
    at: now,
  })

  await db.clientMembership.update({
    where: { id: membership.id },
    data: { planId: newPlan.id },
  })

  /*
   * The period is NOT restarted. A client who upgrades on the 20th has already
   * paid to the end of the month, and resetting the clock would charge them a
   * fresh period on top of the difference they have just settled — which is
   * the double-charge every subscription complaint is about.
   */
  return { proration }
}

// --- when things go wrong ---------------------------------------------------

/**
 * A provider event about a subscription, applied to the membership it names.
 *
 * Keyed on `stripeSubscriptionId` rather than metadata, because that is what
 * the provider guarantees to send back on every event about it — metadata is
 * whatever was attached at creation and does not survive a subscription
 * recreated by hand in the provider's own dashboard, which is how a salon
 * actually fixes things at four in the afternoon.
 */
export async function applySubscriptionEvent(event: {
  type: string
  subscriptionRef: string
  currentPeriodEnd?: string | null
  now?: Date
}): Promise<{ handled: boolean; membershipId?: string; status?: string }> {
  const now = event.now ?? new Date()

  const membership = await unsafeDb.clientMembership.findFirst({
    where: { stripeSubscriptionId: event.subscriptionRef },
    select: { id: true, salonId: true, clientProfileId: true, currentPeriodStart: true, renewsAt: true },
  })
  if (!membership) return { handled: false }

  const periodEnd = event.currentPeriodEnd ? new Date(event.currentPeriodEnd) : null

  if (event.type.endsWith('.deleted')) {
    await unsafeDb.clientMembership.update({
      where: { id: membership.id },
      data: { status: 'CANCELLED', cancelledAt: now, pastDueSince: null },
    })
    return { handled: true, membershipId: membership.id, status: 'CANCELLED' }
  }

  if (event.type.includes('payment_failed')) {
    /*
     * The FIRST failure is what the dunning clock runs from, so a second
     * failure must not reset it — otherwise a card that declines weekly is
     * never more than a week overdue and the membership never resolves either
     * way.
     */
    await unsafeDb.clientMembership.updateMany({
      where: { id: membership.id, pastDueSince: null },
      data: { pastDueSince: now },
    })
    await unsafeDb.clientMembership.update({
      where: { id: membership.id },
      data: { status: 'PAST_DUE' },
    })

    await materialiseNotification({
      salonId: membership.salonId,
      trigger: 'DEPOSIT_DUE',
      refType: 'ClientMembership',
      refId: `${membership.id}:${now.toISOString().slice(0, 10)}`,
      clientProfileId: membership.clientProfileId,
    })

    return { handled: true, membershipId: membership.id, status: 'PAST_DUE' }
  }

  /*
   * A successful payment or an update. Clearing `pastDueSince` is the important
   * half — a membership that recovers must not carry a dunning clock that would
   * cancel it three weeks after a failure it has already fixed.
   */
  const advanced = periodEnd !== null && periodEnd.getTime() !== membership.renewsAt?.getTime()

  await unsafeDb.clientMembership.update({
    where: { id: membership.id },
    data: {
      status: 'ACTIVE',
      pastDueSince: null,
      ...(periodEnd ? { renewsAt: periodEnd } : {}),
      // A new period means a fresh allowance, which is what `periodStart` keys.
      ...(advanced ? { currentPeriodStart: now } : {}),
    },
  })

  return { handled: true, membershipId: membership.id, status: 'ACTIVE' }
}

/**
 * Walk the overdue memberships and do whatever their age says.
 *
 * Reads the state each time rather than scheduling the stages in advance,
 * because a client who pays on day eight should not receive a cancellation
 * notice queued on day one — and a schedule minted per stage would have to be
 * found and cancelled.
 */
export async function sweepDunning(now = new Date()): Promise<{ suspended: number; cancelled: number }> {
  const overdue = await unsafeDb.clientMembership.findMany({
    where: { status: { in: ['PAST_DUE'] }, pastDueSince: { not: null } },
    select: { id: true, salonId: true, clientProfileId: true, pastDueSince: true },
    take: 500,
  })

  let suspended = 0
  let cancelled = 0

  for (const membership of overdue) {
    const action = dunningAction(membership.pastDueSince!, now)
    if (action.cancel) {
      await unsafeDb.clientMembership.update({
        where: { id: membership.id },
        data: { status: 'CANCELLED', cancelledAt: now },
      })
      cancelled += 1
      continue
    }
    if (action.suspend) suspended += 1
  }

  return { suspended, cancelled }
}

/**
 * End the memberships whose period has run out after somebody cancelled.
 *
 * The other half of cancelling at period end: without this the flag is set and
 * nothing ever acts on it, which is a client still being charged for something
 * they told the salon to stop.
 */
export async function sweepCancellations(now = new Date()): Promise<{ ended: number }> {
  const due = await unsafeDb.clientMembership.updateMany({
    where: {
      status: { in: ['ACTIVE', 'PAST_DUE'] },
      cancelAtPeriodEnd: true,
      renewsAt: { lte: now },
    },
    data: { status: 'CANCELLED', cancelledAt: now },
  })
  return { ended: due.count }
}

// --- the salon's own plans --------------------------------------------------

export async function salonPlans(salonId: string) {
  const db = dbFor(salonId)
  return db.clientMembershipPlan.findMany({
    where: { salonId },
    orderBy: [{ isActive: 'desc' }, { priceCents: 'asc' }],
    select: {
      id: true,
      name: true,
      descriptionText: true,
      priceCents: true,
      interval: true,
      includedJson: true,
      isActive: true,
      _count: { select: { memberships: true } },
    },
  })
}

function periodOf(interval: string): number {
  return interval === 'YEAR' ? PERIOD_MS.YEAR : PERIOD_MS.MONTH
}
