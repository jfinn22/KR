import { unsafeDb } from '@/server/db/client'
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

export async function startPlatformSubscription(input: {
  salonId: string
  planCode: string
  yearly?: boolean
  contactEmail?: string | null
}): Promise<{ subscriptionRef: string | null }> {
  const [subscription, plan] = await Promise.all([
    unsafeDb.subscription.findUnique({
      where: { salonId: input.salonId },
      select: { id: true, stripeCustomerId: true, stripeSubscriptionId: true },
    }),
    unsafeDb.plan.findUnique({
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

  const customerRef =
    subscription.stripeCustomerId ??
    (
      await paymentsPort().createCustomer({
        email: input.contactEmail ?? null,
        idempotencyKey: `platform-customer:${input.salonId}`,
        metadata: { salonId: input.salonId },
      })
    ).id

  const result = await paymentsPort().createSubscription({
    customerRef,
    priceId,
    idempotencyKey: `platform-sub:${input.salonId}:${plan.code}`,
  })

  await unsafeDb.subscription.update({
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

  const status = event.type.endsWith('.deleted')
    ? 'CANCELLED'
    : event.type.includes('payment_failed')
      ? 'PAST_DUE'
      : 'ACTIVE'

  await unsafeDb.subscription.update({
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
