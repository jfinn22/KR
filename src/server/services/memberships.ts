import { unsafeDb } from '@/server/db/client'
import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import { paymentsPort } from '@/ports/registry'
import { AdapterError } from '@/ports/types'
import { materialiseNotification } from './notifications'
import {
  applyEntitlements,
  dunningAction,
  entitlementsOf,
  keyOf,
  prorate,
  recogniseRevenue,
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

  /*
   * Lock the membership row and refuse to write an allowance that has already
   * been spent this period. Two concurrent checkouts both reading "one free
   * cut left" used to both create use rows — the unique constraint cannot
   * cover multi-unit ledgers, so the lock + re-check is the guard.
   */
  await unsafeDb.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ClientMembership" WHERE id = ${input.membershipId} FOR UPDATE`

    const membership = await tx.clientMembership.findFirst({
      where: { id: input.membershipId, salonId: input.salonId },
      select: { currentPeriodStart: true },
    })
    if (!membership) return

    const periodStart = membership.currentPeriodStart ?? new Date(0)
    const already = await tx.membershipBenefitUse.groupBy({
      by: ['entitlementKey'],
      where: {
        salonId: input.salonId,
        membershipId: input.membershipId,
        periodStart,
      },
      _count: { _all: true },
    })
    const usedByKey = new Map(already.map((row) => [row.entitlementKey, row._count._all]))

    // Re-load entitlements to know the allowance ceiling.
    const full = await tx.clientMembership.findFirst({
      where: { id: input.membershipId, salonId: input.salonId },
      include: { plan: { select: { includedJson: true } } },
    })
    if (!full) return

    const entitlements = entitlementsOf(full.plan.includedJson)
    const ceilingByKey = new Map(
      entitlements.map((entitlement) => [keyOf(entitlement), entitlement.perPeriod] as const),
    )

    const allowed: typeof input.benefits = []
    for (const benefit of input.benefits) {
      const ceiling = ceilingByKey.get(benefit.entitlementKey) ?? null
      const used = usedByKey.get(benefit.entitlementKey) ?? 0
      if (ceiling != null && used + benefit.units > ceiling) {
        throw new DomainError(
          'CONFLICT',
          `That membership allowance for ${benefit.label} has already been used this period.`,
        )
      }
      usedByKey.set(benefit.entitlementKey, used + benefit.units)
      allowed.push(benefit)
    }

    // Idempotent on the same invoice: a retry must not double-count.
    const prior = await tx.membershipBenefitUse.count({
      where: {
        salonId: input.salonId,
        membershipId: input.membershipId,
        invoiceId: input.invoiceId,
      },
    })
    if (prior > 0) return

    await tx.membershipBenefitUse.createMany({
      /*
       * One row per unit of allowance spent, not one per line. A line of two
       * haircuts against "two cuts a month" spends both, and a single row would
       * leave the client a free cut they have already had.
       */
      data: allowed.flatMap((benefit) =>
        Array.from({ length: Math.max(1, benefit.units) }, (_, unit) => ({
          salonId: input.salonId,
          membershipId: input.membershipId,
          invoiceId: input.invoiceId,
          entitlementKey: benefit.entitlementKey,
          label: benefit.label,
          // The whole saving goes on the first row of the benefit and zero on
          // the rest, so summing the ledger gives what the membership actually
          // saved rather than a multiple of it.
          discountCents: unit === 0 ? benefit.discountCents : 0,
          periodStart,
        })),
      ),
    })
  })
}

/**
 * Give an allowance back when the bill it was used on is undone.
 *
 * Called from the refund path, on a refund that takes the whole invoice back.
 * A client whose visit was refunded still has their free cut this month —
 * charging them for the allowance of a service they were not, in the end, given
 * is the salon keeping something for nothing.
 *
 * A PARTIAL refund does not release: the visit still happened and the benefit
 * still landed on it, and handing the allowance back on a goodwill tenner off
 * would let the same benefit be spent twice.
 */
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

  /*
   * The local row first, so its id can key the provider call.
   *
   * The key used to be salon + client + plan, which is the same string every
   * time — so a client who joined, cancelled and rejoined got the provider's
   * cached reply and was handed back the id of the DEAD subscription. The new
   * membership would then have looked live locally while nothing charged it,
   * and every webhook about it would have landed on the cancelled row.
   */
  const membership = await db.clientMembership.create({
    data: {
      salonId: input.salonId,
      clientProfileId: input.clientProfileId,
      planId: plan.id,
      status: 'ACTIVE',
      startedAt: now,
      currentPeriodStart: now,
      renewsAt,
      stripeSubscriptionId: null,
    },
    select: { id: true },
  })

  if (plan.stripePriceId) {
    const result = await paymentsPort().createSubscription({
      customerRef: client.paymentsCustomerRef,
      priceId: plan.stripePriceId,
      idempotencyKey: `sub:${membership.id}`,
    })
    stripeSubscriptionId = result.id
    renewsAt = new Date(result.currentPeriodEnd)

    await db.clientMembership.update({
      where: { id: membership.id },
      data: { stripeSubscriptionId, renewsAt },
    })
  }

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
    select: { id: true, renewsAt: true, status: true, stripeSubscriptionId: true },
  })
  if (!membership) throw new DomainError('NOT_FOUND', 'That membership is not here.')
  if (membership.status === 'CANCELLED') {
    throw new DomainError('CONFLICT', 'That membership has already ended.')
  }

  /*
   * The provider first, then the row.
   *
   * This used to write only the local row, so a cancelled membership kept
   * being charged every month — the client would see the salon still taking
   * their money for something the salon's own screen said had stopped, which
   * is the worst version of this bug rather than a cosmetic one. Provider
   * first because a failure there must not leave a row saying "cancelled"
   * over a subscription that is still billing.
   */
  if (membership.stripeSubscriptionId) {
    try {
      await paymentsPort().cancelSubscription({
        subscriptionRef: membership.stripeSubscriptionId,
        atPeriodEnd: !input.immediately,
        idempotencyKey: `cancel:${membership.id}:${input.immediately ? 'now' : 'end'}`,
      })
    } catch (err) {
      /*
       * A reference the provider has never heard of is not a reason to refuse.
       *
       * It happens: a subscription cancelled by hand in the provider's
       * dashboard, or a row brought across from whatever the salon used
       * before. The goal — stop charging them — is already true, and refusing
       * would leave a salon unable to end a membership because of a stale
       * string. Anything else, including a network failure, still aborts:
       * writing "cancelled" over a subscription that is still billing is the
       * one outcome worse than an error message.
       */
      if (!(err instanceof AdapterError) || err.code !== 'NOT_FOUND') throw err
    }
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
 * Put it on hold, or take it off hold.
 *
 * `ClientMembershipStatus.PAUSED` has been read in four places since the
 * schema was written — `membershipFor` reports it as suspended and
 * `benefitsForBill` withholds against it — and no code path could ever produce
 * it. This is the writer.
 *
 * Worth having because the alternative a client is offered otherwise is
 * cancelling, and a cancelled member is one the salon has to sell all over
 * again. Somebody away for three months keeps their membership, their history
 * and their price, and is not charged for months they cannot use — collection
 * stops at the provider too, because a pause that kept billing would be
 * strictly worse for them than cancelling.
 */
export async function setMembershipPaused(input: {
  salonId: string
  membershipId: string
  paused: boolean
  now?: Date
}): Promise<{ status: string }> {
  const now = input.now ?? new Date()
  const db = dbFor(input.salonId)

  const membership = await db.clientMembership.findFirst({
    where: { id: input.membershipId, salonId: input.salonId },
    select: { id: true, status: true, stripeSubscriptionId: true, pastDueSince: true },
  })
  if (!membership) throw new DomainError('NOT_FOUND', 'That membership is not here.')
  if (membership.status === 'CANCELLED') {
    throw new DomainError('CONFLICT', 'That membership has already ended.')
  }
  if (input.paused && membership.status === 'PAUSED') {
    throw new DomainError('CONFLICT', 'That membership is already on hold.')
  }
  if (!input.paused && membership.status !== 'PAUSED') {
    throw new DomainError('CONFLICT', 'That membership is not on hold.')
  }

  /*
   * A membership that was overdue when it was paused comes back overdue. The
   * money owed did not stop being owed because the client went away, and
   * resuming to ACTIVE would quietly forgive it.
   */
  if (membership.stripeSubscriptionId) {
    try {
      await paymentsPort().pauseSubscription({
        subscriptionRef: membership.stripeSubscriptionId,
        paused: input.paused,
        idempotencyKey: `pause:${membership.id}:${input.paused ? 'on' : 'off'}:${now.getTime()}`,
      })
    } catch (err) {
      if (!(err instanceof AdapterError) || err.code !== 'NOT_FOUND') throw err
    }
  }

  const status = input.paused
    ? 'PAUSED'
    : membership.pastDueSince
      ? 'PAST_DUE'
      : 'ACTIVE'
  await db.clientMembership.update({
    where: { id: membership.id },
    data: { status },
  })

  return { status }
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
        stripeSubscriptionId: true,
        plan: { select: { id: true, priceCents: true, interval: true, includedJson: true } },
      },
    }),
    db.clientMembershipPlan.findFirst({
      where: { id: input.newPlanId, salonId: input.salonId, isActive: true },
      select: { id: true, priceCents: true, interval: true, includedJson: true, stripePriceId: true },
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

  /*
   * The provider moves too, or the salon keeps taking the old price.
   *
   * This used to write `planId` and nothing else: the client was shown a
   * proration, agreed to it, and then the provider charged them the OLD amount
   * every month while the salon's screen showed the new plan. `updateSubscription`
   * bills the difference for the remainder of the period, which is the same
   * straight-line arithmetic `prorate` does above — so the two numbers agree to
   * rounding, and the figure read out at the counter is what actually lands.
   *
   * On a plan with no price at the provider — the on-account arrangement that
   * `subscribeClient` deliberately allows — there is nothing to move and the
   * proration is what the desk collects by hand.
   */
  if (membership.stripeSubscriptionId && newPlan.stripePriceId) {
    await paymentsPort().updateSubscription({
      subscriptionRef: membership.stripeSubscriptionId,
      priceId: newPlan.stripePriceId,
      idempotencyKey: `plan-change:${membership.id}:${newPlan.id}:${periodStart.getTime()}`,
    })
  }

  await db.clientMembership.update({
    where: { id: membership.id },
    data: { planId: newPlan.id },
  })

  /*
   * Carry this period's uses onto their counterpart in the new plan.
   *
   * Uses are keyed `serviceId:kind:value`, so moving from "20% off colour" to
   * "30% off colour" changed the key and the allowance read as untouched — the
   * client had their discounted colour on the 5th, upgraded on the 6th, and
   * got another. Matched on service and kind, which is the benefit's identity;
   * the value is what they moved to change. A benefit with no counterpart in
   * the new plan is dropped, because there is nothing left for it to count
   * against.
   */
  const counterpart = new Map(
    entitlementsOf(newPlan.includedJson).map((e) => [`${e.serviceId ?? '*'}:${e.kind}`, keyOf(e)]),
  )
  const uses = await db.membershipBenefitUse.findMany({
    where: { salonId: input.salonId, membershipId: membership.id, periodStart },
    select: { id: true, entitlementKey: true },
  })
  for (const use of uses) {
    const [serviceId, kind] = use.entitlementKey.split(':')
    const moved = counterpart.get(`${serviceId}:${kind}`)
    if (moved === undefined) {
      await db.membershipBenefitUse.delete({ where: { id: use.id } })
    } else if (moved !== use.entitlementKey) {
      await db.membershipBenefitUse.update({
        where: { id: use.id },
        data: { entitlementKey: moved },
      })
    }
  }

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
    select: {
      id: true,
      salonId: true,
      clientProfileId: true,
      status: true,
      currentPeriodStart: true,
      renewsAt: true,
    },
  })
  if (!membership) return { handled: false }

  const periodEnd = event.currentPeriodEnd ? new Date(event.currentPeriodEnd) : null

  /*
   * A cancelled membership stays cancelled.
   *
   * The provider keeps emitting about a subscription after it ends, and every
   * one of those events used to fall through to the ACTIVE branch below — so a
   * membership somebody had cancelled came back to life, benefits and all, on
   * the next echo. Coming back is `subscribeClient`'s job, and that writes a
   * new row rather than reviving this one.
   */
  if (membership.status === 'CANCELLED' && !event.type.endsWith('.deleted')) {
    return { handled: true, membershipId: membership.id, status: 'CANCELLED' }
  }

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
   * Everything else is either money arriving or the provider narrating.
   *
   * Only money clears the dunning clock. `customer.subscription.updated` fires
   * for a changed card, a changed price, a changed anything — and treating it
   * as proof of payment wiped the clock a failure had just started, so a
   * membership on a card that never works would sit PAST_DUE for one day at a
   * time and never reach the end of the ladder.
   */
  const paid = event.type.includes('payment_succeeded') || event.type.endsWith('invoice.paid')

  /*
   * A new period means a fresh allowance, and it starts where the old one
   * ended rather than whenever the webhook happened to arrive. A late event
   * would otherwise leave a gap in which a visit belongs to neither period.
   */
  const advanced = periodEnd !== null && periodEnd.getTime() !== membership.renewsAt?.getTime()
  const newPeriodStart = membership.renewsAt ?? now

  await unsafeDb.clientMembership.update({
    where: { id: membership.id },
    data: {
      ...(paid ? { status: 'ACTIVE' as const, pastDueSince: null } : {}),
      ...(periodEnd ? { renewsAt: periodEnd } : {}),
      ...(advanced ? { currentPeriodStart: newPeriodStart } : {}),
    },
  })

  return {
    handled: true,
    membershipId: membership.id,
    status: paid ? 'ACTIVE' : membership.status,
  }
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
    select: {
      id: true,
      salonId: true,
      clientProfileId: true,
      pastDueSince: true,
      stripeSubscriptionId: true,
    },
    take: 500,
  })

  let suspended = 0
  let cancelled = 0

  for (const membership of overdue) {
    const action = dunningAction(membership.pastDueSince!, now)

    /*
     * `tellClient` was computed at every stage and read by nobody, so the whole
     * ladder ran in silence: benefits stopped at a week and the membership
     * ended at three, and the first the client knew of either was a bill at the
     * counter that was larger than they expected. Most of these failures are an
     * expired card on somebody who fully intends to keep paying — which is the
     * entire argument for waiting three weeks, and the argument is worthless if
     * nobody is asked to fix it.
     *
     * Keyed on the STAGE rather than the day, so each of the three says its
     * piece exactly once however often the sweep runs.
     */
    if (action.tellClient) {
      await materialiseNotification({
        salonId: membership.salonId,
        trigger: 'DEPOSIT_DUE',
        refType: 'ClientMembership',
        refId: `${membership.id}:${action.stage}`,
        clientProfileId: membership.clientProfileId,
      })
    }

    if (action.cancel) {
      /*
       * Provider first — the same rule as a manual cancel. Ending the row
       * locally while Stripe keeps charging is a client paying for nothing.
       */
      if (membership.stripeSubscriptionId) {
        try {
          await paymentsPort().cancelSubscription({
            subscriptionRef: membership.stripeSubscriptionId,
            atPeriodEnd: false,
            idempotencyKey: `dunning-cancel:${membership.id}`,
          })
        } catch (err) {
          if (!(err instanceof AdapterError) || err.code !== 'NOT_FOUND') throw err
        }
      }
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

export interface MembershipRevenue {
  members: number
  /** What the memberships bring in over a month, whatever each one's interval. */
  monthlyRunRateCents: number
  /** Collected for the periods currently running. */
  takenCents: number
  /** Of that, the part the salon has actually earned by now. */
  earnedCents: number
  /** And the part it has not — money in the bank that is still owed as service. */
  deferredCents: number
}

/**
 * What the memberships are worth, and how much of it the salon has earned.
 *
 * The takings figure elsewhere is cash, and it stays cash — moving this
 * platform's revenue reporting to accrual is a decision an owner makes with
 * their accountant, not one a release makes for them. This sits beside it
 * instead, because the number an owner most needs before they spend a
 * membership month is the part of it they have not earned yet.
 *
 * Forty members at forty-five pounds collected on the first is eighteen hundred
 * in the bank on the second, of which about seventeen hundred and forty is
 * still owed as haircuts. Salons that treat the first figure as income are the
 * ones that cannot afford the January their members all turn up in.
 */
export async function membershipRevenue(
  salonId: string,
  asOf = new Date(),
): Promise<MembershipRevenue> {
  const memberships = await dbFor(salonId).clientMembership.findMany({
    /*
     * PAST_DUE is in, CANCELLED is out. Somebody whose card failed is still a
     * member with a period running and benefits to honour until dunning ends
     * it, so the service they are owed is a real liability.
     */
    where: { salonId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
    select: {
      currentPeriodStart: true,
      renewsAt: true,
      plan: { select: { priceCents: true, interval: true } },
    },
  })

  let monthlyRunRateCents = 0
  let takenCents = 0
  let earnedCents = 0
  let deferredCents = 0

  for (const membership of memberships) {
    const price = membership.plan.priceCents
    monthlyRunRateCents +=
      membership.plan.interval === 'YEAR' ? Math.round(price / 12) : price

    /*
     * A membership with no period on it is one the provider has not confirmed
     * yet. Counting its fee as taken would invent money; leaving it out of the
     * run rate would understate what the salon sells. So it counts towards the
     * run rate above and towards nothing below.
     */
    const periodStart = membership.currentPeriodStart
    const periodEnd = membership.renewsAt
    if (!periodStart || !periodEnd) continue

    const recognition = recogniseRevenue({
      paidCents: price,
      periodStart,
      periodEnd,
      asOf,
    })
    takenCents += price
    earnedCents += recognition.earnedCents
    deferredCents += recognition.deferredCents
  }

  return {
    members: memberships.length,
    monthlyRunRateCents,
    takenCents,
    earnedCents,
    deferredCents,
  }
}

function periodOf(interval: string): number {
  return interval === 'YEAR' ? PERIOD_MS.YEAR : PERIOD_MS.MONTH
}
