import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import {
  applyPlatformSubscriptionEvent,
  choosePlatformPlan,
  platformBillingFor,
  startPlatformSubscription,
} from '@/server/services/platform-billing'

/**
 * What the salon pays this platform, as opposed to what its clients pay it.
 *
 * `Subscription` has carried `stripeCustomerId`, `stripeSubscriptionId` and
 * `currentPeriodEnd` since the first migration with nothing ever writing any of
 * them, so every salon in the database has been `TRIALING` forever. The
 * interesting cases here are all about what a salon keeps: the period they have
 * already bought when they move tier, and their whole diary when a card fails.
 */

const S = 'pb_salon'

/**
 * The plan catalogue is global rather than tenant-scoped, so it is not part of
 * any salon's teardown. Written fresh each time, prices included, because one
 * test below deliberately nulls a price and every other test needs it back.
 */
const CATALOGUE = [
  { code: 'STARTER' as const, name: 'Starter', monthly: 2_900, yearly: 29_000, loc: 1, sty: 1 },
  { code: 'PRO' as const, name: 'Pro', monthly: 8_900, yearly: 89_000, loc: 1, sty: 8 },
  { code: 'SALON' as const, name: 'Salon', monthly: 19_900, yearly: 199_000, loc: 25, sty: 100 },
]

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  // `User` is global, so deleting the salon cascades the membership and the
  // stylist profile but leaves the person behind — and the next test that adds
  // stylists collides on the unique email.
  await unsafeDb.user.deleteMany({ where: { email: { endsWith: '@pb.test' } } })

  for (const [index, plan] of CATALOGUE.entries()) {
    const fields = {
      name: plan.name,
      descriptionText: `${plan.name} plan`,
      monthlyPriceCents: plan.monthly,
      yearlyPriceCents: plan.yearly,
      maxLocations: plan.loc,
      maxStylists: plan.sty,
      featuresJson: {},
      stripePriceIdMonthly: `price_test_${plan.code.toLowerCase()}_m`,
      stripePriceIdYearly: `price_test_${plan.code.toLowerCase()}_y`,
      sortOrder: index,
    }
    await unsafeDb.plan.upsert({
      where: { code: plan.code },
      update: fields,
      create: { code: plan.code, ...fields },
    })
  }

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'pb-salon',
      name: 'Platform Billing Test Salon',
      defaultTimezone: 'Europe/London',
      contactEmail: 'owner@pb.test',
      settings: { create: {} },
      locations: { create: { id: 'pb_loc', name: 'Main', timezone: 'Europe/London' } },
      subscription: { create: { planCode: 'PRO', status: 'TRIALING' } },
    },
  })
}

async function addStylists(count: number) {
  for (let i = 0; i < count; i += 1) {
    const user = await unsafeDb.user.create({
      data: { email: `pb_sty_${i}@pb.test`, name: `Stylist ${i}` },
    })
    const membership = await unsafeDb.membership.create({
      data: { salonId: S, userId: user.id, role: 'STYLIST' },
    })
    await unsafeDb.stylistProfile.create({
      data: {
        salonId: S,
        membershipId: membership.id,
        displayName: `Stylist ${i}`,
        defaultLocationId: 'pb_loc',
      },
    })
  }
}

beforeEach(seed)
afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { endsWith: '@pb.test' } } })
})

describe('reading what the salon is on', () => {
  it('reports the trial as not yet live, because nothing has been charged', async () => {
    const view = await platformBillingFor(S)
    expect(view?.planCode).toBe('PRO')
    expect(view?.status).toBe('TRIALING')
    expect(view?.live).toBe(false)
  })

  it('names the tiers the salon has outgrown, with the numbers', async () => {
    await addStylists(3)

    const view = await platformBillingFor(S)
    const starter = view?.catalogue.find((plan) => plan.code === 'STARTER')

    // Three stylists against Starter's one. An owner reading a cheaper tier
    // needs this BEFORE they pick it, not as a failure afterwards.
    expect(starter?.overBy).toEqual({ locations: 0, stylists: 2 })
    expect(view?.catalogue.find((plan) => plan.code === 'SALON')?.overBy).toBeNull()
  })

  it('never marks the plan the salon is already on as outgrown', async () => {
    await addStylists(3)
    // PRO allows 8, so this is not the interesting case; SALON is where the
    // salon sits after a move it was allowed to make.
    await unsafeDb.subscription.update({ where: { salonId: S }, data: { planCode: 'STARTER' } })

    const view = await platformBillingFor(S)
    expect(view?.catalogue.find((plan) => plan.code === 'STARTER')?.overBy).toBeNull()
  })

  it('returns nothing for a salon with no subscription row at all', async () => {
    await unsafeDb.subscription.deleteMany({ where: { salonId: S } })
    expect(await platformBillingFor(S)).toBeNull()
  })
})

describe('starting to pay', () => {
  it('writes the provider columns that have been null since the first migration', async () => {
    const { subscriptionRef } = await startPlatformSubscription({ salonId: S, planCode: 'PRO' })
    expect(subscriptionRef).toBeTruthy()

    const row = await unsafeDb.subscription.findUnique({ where: { salonId: S } })
    expect(row?.stripeCustomerId).toBeTruthy()
    expect(row?.stripeSubscriptionId).toBe(subscriptionRef)
    expect(row?.currentPeriodEnd).toBeInstanceOf(Date)
  })

  it('refuses to start twice', async () => {
    await startPlatformSubscription({ salonId: S, planCode: 'PRO' })
    await expect(startPlatformSubscription({ salonId: S, planCode: 'PRO' })).rejects.toThrow(
      /already subscribed/i,
    )
  })

  it('says a missing price is the platform’s problem, not the salon’s', async () => {
    await unsafeDb.plan.update({
      where: { code: 'PRO' },
      data: { stripePriceIdMonthly: null },
    })
    await expect(startPlatformSubscription({ salonId: S, planCode: 'PRO' })).rejects.toThrow(
      /no price set up/i,
    )
  })
})

describe('choosing a plan', () => {
  it('starts a subscription for a salon that has never had one', async () => {
    const result = await choosePlatformPlan({ salonId: S, planCode: 'PRO' })
    expect(result.started).toBe(true)

    const row = await unsafeDb.subscription.findUnique({ where: { salonId: S } })
    expect(row?.planCode).toBe('PRO')
    expect(row?.stripeSubscriptionId).toBeTruthy()
  })

  it('moves a live subscription WITHOUT restarting the period', async () => {
    await choosePlatformPlan({ salonId: S, planCode: 'PRO' })
    const before = await unsafeDb.subscription.findUnique({ where: { salonId: S } })

    const result = await choosePlatformPlan({ salonId: S, planCode: 'SALON' })
    expect(result.started).toBe(false)

    const after = await unsafeDb.subscription.findUnique({ where: { salonId: S } })
    expect(after?.planCode).toBe('SALON')
    // The whole point. Cancel-and-recreate would move this forward, and bill a
    // fresh period on top of the one the salon has already settled.
    expect(after?.currentPeriodEnd?.getTime()).toBe(before?.currentPeriodEnd?.getTime())
    expect(after?.stripeSubscriptionId).toBe(before?.stripeSubscriptionId)
  })

  it('refuses a tier the salon no longer fits into, and names the numbers', async () => {
    await addStylists(3)
    await choosePlatformPlan({ salonId: S, planCode: 'PRO' })

    await expect(choosePlatformPlan({ salonId: S, planCode: 'STARTER' })).rejects.toThrow(
      /allows 1 stylist and 1 location\. You have 3 and 1\./,
    )
  })

  it('refuses the plan the salon is already paying for', async () => {
    await choosePlatformPlan({ salonId: S, planCode: 'PRO' })
    await expect(choosePlatformPlan({ salonId: S, planCode: 'PRO' })).rejects.toThrow(
      /already the plan/i,
    )
  })

  it('lets a salon still on trial pick the plan their row already names', async () => {
    // Not a no-op: the row says PRO but nothing has ever been charged, so this
    // is the trial converting rather than a move between tiers.
    const result = await choosePlatformPlan({ salonId: S, planCode: 'PRO' })
    expect(result.started).toBe(true)
  })
})

describe('a provider event about the salon’s own subscription', () => {
  it('moves the status and switches nothing off', async () => {
    const { subscriptionRef } = await choosePlatformPlan({ salonId: S, planCode: 'PRO' })

    const result = await applyPlatformSubscriptionEvent({
      type: 'customer.subscription.updated.payment_failed',
      subscriptionRef: subscriptionRef!,
    })
    expect(result).toEqual({ handled: true, status: 'PAST_DUE' })

    const row = await unsafeDb.subscription.findUnique({ where: { salonId: S } })
    expect(row?.status).toBe('PAST_DUE')
    // The plan is untouched, which is what `requireFeature` reads. A salon
    // whose card expired still has clients arriving at nine tomorrow.
    expect(row?.planCode).toBe('PRO')
  })

  it('records the failure where an operator will see it', async () => {
    const { subscriptionRef } = await choosePlatformPlan({ salonId: S, planCode: 'PRO' })
    await unsafeDb.outbox.deleteMany({ where: { salonId: S } })

    await applyPlatformSubscriptionEvent({
      type: 'invoice.payment_failed',
      subscriptionRef: subscriptionRef!,
    })

    const events = await unsafeDb.outbox.findMany({ where: { salonId: S } })
    expect(events.map((e) => e.topic)).toContain('platform.subscription.past_due')
  })

  it('ignores an event for a subscription this platform does not know', async () => {
    expect(
      await applyPlatformSubscriptionEvent({
        type: 'customer.subscription.deleted',
        subscriptionRef: 'sub_someone_else',
      }),
    ).toEqual({ handled: false })
  })

  it('clears the pending cancellation when the subscription actually ends', async () => {
    const { subscriptionRef } = await choosePlatformPlan({ salonId: S, planCode: 'PRO' })
    await unsafeDb.subscription.update({
      where: { salonId: S },
      data: { cancelAtPeriodEnd: true },
    })

    await applyPlatformSubscriptionEvent({
      type: 'customer.subscription.deleted',
      subscriptionRef: subscriptionRef!,
    })

    const row = await unsafeDb.subscription.findUnique({ where: { salonId: S } })
    expect(row?.status).toBe('CANCELLED')
    expect(row?.cancelAtPeriodEnd).toBe(false)
  })
})
