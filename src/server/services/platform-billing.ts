import { unsafeDb } from '@/server/db/client'
import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import { paymentsPort } from '@/ports/registry'

/**
 * What the salon pays this platform.
 *
 * `Subscription` has carried `stripeCustomerId`, `stripeSubscriptionId` and
 * `currentPeriodEnd` since the initial migration, and `Plan` has carried
 * `stripePriceIdMonthly` and `stripePriceIdYearly`, with nothing ever writing
 * any of them. Every salon in the database is `TRIALING` forever.
 *
 * Deliberately thin, and deliberately last. Client memberships are a feature a
 * salon sells; this is the platform's own till, and the only interesting thing
 * about it is that it must never be the reason a salon cannot run their day.
 * A failed platform payment suspends nothing here — it is a conversation, not a
 * kill switch, and a salon locked out of their own diary over a card their
 * bookkeeper will fix on Monday is a salon that leaves.
 */

export interface PlatformBillingView {
  planCode: string
  status: string
  yearly: boolean
  currentPeriodEnd: Date | null
  trialEndsAt: Date | null
  cancelAtPeriodEnd: boolean
  /** True once the provider actually has a subscription for this salon. */
  live: boolean
  usage: { locations: number; stylists: number }
  catalogue: {
    code: string
    name: string
    descriptionText: string
    monthlyPriceCents: number
    yearlyPriceCents: number
    maxLocations: number
    maxStylists: number
    /** Null where the platform has not configured a price at the provider. */
    priceConfigured: boolean
    /** What the salon would have to shed to move down to this one. */
    overBy: { locations: number; stylists: number } | null
  }[]
}

/**
 * What this salon is on, what else there is, and whether they would fit.
 *
 * The last part is the reason this is a service rather than two queries in the
 * page: a salon reading a cheaper tier needs to be told they have four
 * stylists and it allows one BEFORE they pick it, not after the save fails.
 */
export async function platformBillingFor(salonId: string): Promise<PlatformBillingView | null> {
  const db = dbFor(salonId)
  const [subscription, plans, locations, stylists] = await Promise.all([
    db.subscription.findUnique({
      where: { salonId },
      select: {
        planCode: true,
        status: true,
        currentPeriodEnd: true,
        trialEndsAt: true,
        cancelAtPeriodEnd: true,
        stripeSubscriptionId: true,
      },
    }),
    db.plan.findMany({
      orderBy: { sortOrder: 'asc' },
      select: {
        code: true,
        name: true,
        descriptionText: true,
        monthlyPriceCents: true,
        yearlyPriceCents: true,
        maxLocations: true,
        maxStylists: true,
        stripePriceIdMonthly: true,
        stripePriceIdYearly: true,
      },
    }),
    db.location.count({ where: { salonId, isActive: true } }),
    db.stylistProfile.count({ where: { salonId, isActive: true } }),
  ])

  if (!subscription) return null

  const current = plans.find((p) => p.code === subscription.planCode)
  /*
   * Which of the two prices the salon is on is not stored — only the price id
   * sent to the provider is, and that is on the Plan row rather than here.
   * Read it back off the period: a year-long period is a yearly plan. Wrong
   * only for a subscription somebody edited at the provider directly.
   */
  const yearly =
    subscription.currentPeriodEnd !== null &&
    subscription.currentPeriodEnd.getTime() - Date.now() > 200 * 24 * 60 * 60 * 1000

  return {
    planCode: subscription.planCode,
    status: subscription.status,
    yearly,
    currentPeriodEnd: subscription.currentPeriodEnd,
    trialEndsAt: subscription.trialEndsAt,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    live: subscription.stripeSubscriptionId !== null,
    usage: { locations, stylists },
    catalogue: plans.map((plan) => {
      const overLocations = Math.max(0, locations - plan.maxLocations)
      const overStylists = Math.max(0, stylists - plan.maxStylists)
      return {
        code: plan.code,
        name: plan.name,
        descriptionText: plan.descriptionText,
        monthlyPriceCents: plan.monthlyPriceCents,
        yearlyPriceCents: plan.yearlyPriceCents,
        maxLocations: plan.maxLocations,
        maxStylists: plan.maxStylists,
        priceConfigured: (yearly ? plan.stripePriceIdYearly : plan.stripePriceIdMonthly) !== null,
        overBy:
          plan.code === current?.code || (overLocations === 0 && overStylists === 0)
            ? null
            : { locations: overLocations, stylists: overStylists },
      }
    }),
  }
}

export async function startPlatformSubscription(input: {
  salonId: string
  planCode: string
  yearly?: boolean
  contactEmail?: string | null
}): Promise<{ subscriptionRef: string | null }> {
  const db = dbFor(input.salonId)
  const [subscription, plan] = await Promise.all([
    db.subscription.findUnique({
      where: { salonId: input.salonId },
      select: { id: true, stripeCustomerId: true, stripeSubscriptionId: true },
    }),
    db.plan.findUnique({
      where: { code: input.planCode as never },
      select: { code: true, stripePriceIdMonthly: true, stripePriceIdYearly: true },
    }),
  ])

  if (!subscription) throw new DomainError('NOT_FOUND', 'That salon has no subscription record.')
  if (!plan) throw new DomainError('NOT_FOUND', 'That plan does not exist.')
  if (subscription.stripeSubscriptionId) {
    throw new DomainError('CONFLICT', 'That salon is already subscribed.')
  }

  const priceId = input.yearly ? plan.stripePriceIdYearly : plan.stripePriceIdMonthly
  if (!priceId) {
    /*
     * No price configured is a platform configuration gap, not something the
     * salon did. Said plainly so whoever sees it knows which of the two it is.
     */
    throw new DomainError('INVALID_INPUT', 'That plan has no price set up yet.')
  }

  /*
   * The salon's own contact email, read here rather than passed in. A caller
   * supplying it could supply anybody's, and this is the address the provider
   * sends receipts and card-expiry warnings to.
   */
  const contactEmail =
    input.contactEmail ??
    (
      await db.salon.findUnique({
        where: { id: input.salonId },
        select: { contactEmail: true },
      })
    )?.contactEmail ??
    null

  const customerRef =
    subscription.stripeCustomerId ??
    (
      await paymentsPort().createCustomer({
        email: contactEmail,
        idempotencyKey: `platform-customer:${input.salonId}`,
        metadata: { salonId: input.salonId },
      })
    ).id

  const result = await paymentsPort().createSubscription({
    customerRef,
    priceId,
    idempotencyKey: `platform-sub:${input.salonId}:${plan.code}`,
  })

  await db.subscription.update({
    where: { salonId: input.salonId },
    data: {
      planCode: plan.code,
      status: result.status === 'TRIALING' ? 'TRIALING' : 'ACTIVE',
      stripeCustomerId: customerRef,
      stripeSubscriptionId: result.id,
      currentPeriodEnd: new Date(result.currentPeriodEnd),
    },
  })

  return { subscriptionRef: result.id }
}

/**
 * Start paying, or move between tiers — whichever this salon needs.
 *
 * One entry point because the caller is a screen with one button on it, and
 * making the page work out whether a salon has ever paid before is how the two
 * paths drift. A salon that has never subscribed gets a subscription created; a
 * salon that has gets theirs moved, keeping the period they have already bought.
 */
export async function choosePlatformPlan(input: {
  salonId: string
  planCode: string
  yearly?: boolean
  contactEmail?: string | null
}): Promise<{ subscriptionRef: string | null; started: boolean }> {
  const db = dbFor(input.salonId)
  const [subscription, plan] = await Promise.all([
    db.subscription.findUnique({
      where: { salonId: input.salonId },
      select: { id: true, planCode: true, stripeSubscriptionId: true },
    }),
    db.plan.findUnique({
      where: { code: input.planCode as never },
      select: {
        code: true,
        name: true,
        maxLocations: true,
        maxStylists: true,
        stripePriceIdMonthly: true,
        stripePriceIdYearly: true,
      },
    }),
  ])

  if (!subscription) throw new DomainError('NOT_FOUND', 'That salon has no subscription record.')
  if (!plan) throw new DomainError('NOT_FOUND', 'That plan does not exist.')
  if (subscription.planCode === input.planCode && subscription.stripeSubscriptionId) {
    throw new DomainError('CONFLICT', 'That is already the plan you are on.')
  }

  /*
   * Refused here rather than left to fail later.
   *
   * `requireFeature` gates features by plan, but nothing counts rows against
   * `maxStylists` — so a salon could drop to Starter, keep all eight stylists
   * working, and be silently out of contract. Naming the numbers is also the
   * only way the owner knows what to actually do about it.
   */
  const [locations, stylists] = await Promise.all([
    db.location.count({ where: { salonId: input.salonId, isActive: true } }),
    db.stylistProfile.count({ where: { salonId: input.salonId, isActive: true } }),
  ])
  if (locations > plan.maxLocations || stylists > plan.maxStylists) {
    throw new DomainError(
      'INVALID_INPUT',
      `${plan.name} allows ${plan.maxStylists} ${plan.maxStylists === 1 ? 'stylist' : 'stylists'} and ${plan.maxLocations} ${plan.maxLocations === 1 ? 'location' : 'locations'}. You have ${stylists} and ${locations}.`,
    )
  }

  if (!subscription.stripeSubscriptionId) {
    const started = await startPlatformSubscription(input)
    return { ...started, started: true }
  }

  const priceId = input.yearly ? plan.stripePriceIdYearly : plan.stripePriceIdMonthly
  if (!priceId) throw new DomainError('INVALID_INPUT', 'That plan has no price set up yet.')

  const result = await paymentsPort().updateSubscription({
    subscriptionRef: subscription.stripeSubscriptionId,
    priceId,
    idempotencyKey: `platform-plan:${input.salonId}:${plan.code}:${input.yearly ? 'y' : 'm'}`,
  })

  await db.subscription.update({
    where: { salonId: input.salonId },
    data: {
      planCode: plan.code,
      status: result.status === 'CANCELLED' ? 'CANCELLED' : result.status,
      currentPeriodEnd: new Date(result.currentPeriodEnd),
    },
  })

  return { subscriptionRef: result.id, started: false }
}

/**
 * A provider event about the salon's own subscription.
 *
 * The status moves and nothing else happens. No feature is switched off, no
 * screen is locked: `requireFeature` reads the PLAN, not the payment state, and
 * that separation is on purpose. A salon whose card expired still has clients
 * arriving at nine tomorrow, and taking their diary away over it would cost
 * them their day and this platform their reputation.
 */
export async function applyPlatformSubscriptionEvent(event: {
  type: string
  subscriptionRef: string
  currentPeriodEnd?: string | null
  now?: Date
}): Promise<{ handled: boolean; status?: string }> {
  const now = event.now ?? new Date()

  const subscription = await unsafeDb.subscription.findFirst({
    where: { stripeSubscriptionId: event.subscriptionRef },
    select: { id: true, salonId: true },
  })
  if (!subscription) return { handled: false }

  const db = dbFor(subscription.salonId)
  const status = event.type.endsWith('.deleted')
    ? 'CANCELLED'
    : event.type.includes('payment_failed')
      ? 'PAST_DUE'
      : 'ACTIVE'

  await db.subscription.update({
    where: { id: subscription.id },
    data: {
      status: status as never,
      ...(event.currentPeriodEnd ? { currentPeriodEnd: new Date(event.currentPeriodEnd) } : {}),
      ...(status === 'CANCELLED' ? { cancelAtPeriodEnd: false } : {}),
    },
  })

  // Recorded where an operator will see it, because a platform payment failing
  // is this platform's problem to chase rather than the salon's to discover.
  await unsafeDb.outbox.create({
    data: {
      salonId: subscription.salonId,
      topic: `platform.subscription.${status.toLowerCase()}`,
      payloadJson: { salonId: subscription.salonId, at: now.toISOString() },
    },
  })

  return { handled: true, status }
}
