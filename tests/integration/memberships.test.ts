import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import {
  applySubscriptionEvent,
  benefitsForBill,
  cancelMembership,
  changePlan,
  membershipFor,
  membershipRevenue,
  recordBenefitUse,
  releaseBenefitUse,
  subscribeClient,
  sweepCancellations,
  sweepDunning,
} from '@/server/services/memberships'
import { refundPayment } from '@/server/services/commerce'

/**
 * Ten schema models have described memberships since the beginning and nothing
 * ever created one. Almost everything here is about what happens AFTER the
 * sale, because that is where a subscription business is either trustworthy or
 * not — and where a salon that wins the argument loses the client.
 */

const S = 'mb_salon'
const NOW = new Date('2026-06-15T12:00:00Z')
const PERIOD_START = new Date('2026-06-01T00:00:00Z')
const PERIOD_END = new Date('2026-07-01T00:00:00Z')

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'mb-salon',
      name: 'Membership Test Salon',
      defaultTimezone: 'Europe/London',
      settings: { create: {} },
      locations: { create: { id: 'mb_loc', name: 'Main', timezone: 'Europe/London' } },
      serviceCategories: { create: { id: 'mb_cat', name: 'Hair', slug: 'hair' } },
      clientProfiles: {
        create: { id: 'mb_cli', firstName: 'Ada', lastName: 'Rivera' },
      },
    },
  })

  await unsafeDb.service.createMany({
    data: [
      { id: 'mb_cut', salonId: S, categoryId: 'mb_cat', name: 'Cut', slug: 'cut', basePriceCents: 5_000 },
      { id: 'mb_col', salonId: S, categoryId: 'mb_cat', name: 'Colour', slug: 'colour', basePriceCents: 9_000 },
    ],
  })

  await unsafeDb.clientMembershipPlan.createMany({
    data: [
      {
        id: 'mb_basic',
        salonId: S,
        name: 'Basic',
        priceCents: 3_000,
        interval: 'MONTH',
        includedJson: [
          { kind: 'FREE', serviceId: 'mb_cut', label: 'A cut a month', perPeriod: 1 },
        ] as never,
      },
      {
        id: 'mb_plus',
        salonId: S,
        name: 'Plus',
        priceCents: 5_000,
        interval: 'MONTH',
        includedJson: [
          { kind: 'FREE', serviceId: 'mb_cut', label: 'A cut a month', perPeriod: 1 },
          { kind: 'PERCENT_OFF', serviceId: 'mb_col', value: 2_000, label: '20% off colour' },
        ] as never,
      },
    ],
  })
}

async function membership(over: Record<string, unknown> = {}) {
  return unsafeDb.clientMembership.create({
    data: {
      id: 'mb_m1',
      salonId: S,
      clientProfileId: 'mb_cli',
      planId: 'mb_basic',
      status: 'ACTIVE',
      currentPeriodStart: PERIOD_START,
      renewsAt: PERIOD_END,
      stripeSubscriptionId: 'sub_test',
      ...over,
    },
  })
}

const line = (serviceId: string, unitPriceCents: number) => ({
  serviceId,
  description: serviceId,
  quantity: 1,
  unitPriceCents,
})

beforeEach(seed)
afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
})

describe('selling one', () => {
  it('refuses without a card, rather than failing next month', async () => {
    /*
     * A subscription with no way to collect the second payment fails at the end
     * of the first month and takes the client's goodwill with it. Better to
     * refuse at the counter, where somebody can hand over a card.
     */
    await expect(
      subscribeClient({ salonId: S, clientProfileId: 'mb_cli', planId: 'mb_basic', now: NOW }),
    ).rejects.toThrow(/card on file/)
  })

  it('starts one when there is a card', async () => {
    await unsafeDb.clientProfile.update({
      where: { id: 'mb_cli' },
      data: { paymentsCustomerRef: 'cus_test' },
    })

    const { membershipId } = await subscribeClient({
      salonId: S,
      clientProfileId: 'mb_cli',
      planId: 'mb_basic',
      now: NOW,
    })

    const row = await unsafeDb.clientMembership.findUniqueOrThrow({ where: { id: membershipId } })
    expect(row.status).toBe('ACTIVE')
    expect(row.currentPeriodStart).not.toBeNull()
    expect(row.renewsAt).not.toBeNull()
  })

  it('will not sell a second one to somebody who already has it', async () => {
    await unsafeDb.clientProfile.update({
      where: { id: 'mb_cli' },
      data: { paymentsCustomerRef: 'cus_test' },
    })
    await membership()

    await expect(
      subscribeClient({ salonId: S, clientProfileId: 'mb_cli', planId: 'mb_plus', now: NOW }),
    ).rejects.toThrow(/already on a membership/)
  })
})

describe('what it takes off the bill', () => {
  it('covers the service the plan names', async () => {
    await membership()
    const benefits = await benefitsForBill(S, 'mb_cli', [line('mb_cut', 5_000)], NOW)
    expect(benefits?.totalCents).toBe(5_000)
    expect(benefits?.withheldReason).toBeNull()
  })

  it('runs out after the allowance, across separate bills', async () => {
    /*
     * The ledger is what makes this work across visits. A counter on the
     * membership would be one more running total nobody can check.
     */
    await membership()
    const first = await benefitsForBill(S, 'mb_cli', [line('mb_cut', 5_000)], NOW)
    await recordBenefitUse({
      salonId: S,
      membershipId: 'mb_m1',
      invoiceId: 'inv_1',
      benefits: first!.benefits,
    })

    const second = await benefitsForBill(S, 'mb_cli', [line('mb_cut', 5_000)], NOW)
    expect(second?.totalCents).toBe(0)
  })

  it('gives the allowance back when the invoice is voided', async () => {
    await membership()
    const first = await benefitsForBill(S, 'mb_cli', [line('mb_cut', 5_000)], NOW)
    await recordBenefitUse({
      salonId: S,
      membershipId: 'mb_m1',
      invoiceId: 'inv_1',
      benefits: first!.benefits,
    })
    await releaseBenefitUse(S, 'inv_1')

    const again = await benefitsForBill(S, 'mb_cli', [line('mb_cut', 5_000)], NOW)
    expect(again?.totalCents).toBe(5_000)
  })

  it('starts the allowance again in a new period', async () => {
    await membership()
    const first = await benefitsForBill(S, 'mb_cli', [line('mb_cut', 5_000)], NOW)
    await recordBenefitUse({
      salonId: S,
      membershipId: 'mb_m1',
      invoiceId: 'inv_1',
      benefits: first!.benefits,
    })

    // The provider says the subscription renewed.
    await applySubscriptionEvent({
      type: 'customer.subscription.updated',
      subscriptionRef: 'sub_test',
      currentPeriodEnd: '2026-08-01T00:00:00Z',
      now: PERIOD_END,
    })

    const next = await benefitsForBill(S, 'mb_cli', [line('mb_cut', 5_000)], PERIOD_END)
    expect(next?.totalCents).toBe(5_000)
  })

  it('withholds benefits from a suspended membership, and says why', async () => {
    /*
     * A membership that keeps giving away haircuts against a card that does not
     * work is one the salon is paying for. It is said out loud so the desk can
     * tell the client rather than looking like the till is broken.
     */
    await membership({
      status: 'PAST_DUE',
      pastDueSince: new Date(NOW.getTime() - 10 * 86_400_000),
    })

    const benefits = await benefitsForBill(S, 'mb_cli', [line('mb_cut', 5_000)], NOW)
    expect(benefits?.totalCents).toBe(0)
    expect(benefits?.withheldReason).toMatch(/has not gone through/)
  })

  it('still pays out in the first week of being overdue', async () => {
    // Most failures are an expired card on somebody who fully intends to pay.
    await membership({
      status: 'PAST_DUE',
      pastDueSince: new Date(NOW.getTime() - 2 * 86_400_000),
    })

    expect((await benefitsForBill(S, 'mb_cli', [line('mb_cut', 5_000)], NOW))?.totalCents).toBe(5_000)
  })

  it('says nothing at all for a client with no membership', async () => {
    expect(await benefitsForBill(S, 'mb_cli', [line('mb_cut', 5_000)], NOW)).toBeNull()
  })
})

describe('what the provider tells us', () => {
  it('marks it past due on the first failure and does not reset the clock on the second', async () => {
    /*
     * The dunning clock runs from the FIRST failure. A card that declines
     * weekly would otherwise never be more than a week overdue, and the
     * membership would never resolve either way.
     */
    await membership()
    const first = new Date('2026-06-02T00:00:00Z')
    await applySubscriptionEvent({
      type: 'invoice.payment_failed',
      subscriptionRef: 'sub_test',
      now: first,
    })
    await applySubscriptionEvent({
      type: 'invoice.payment_failed',
      subscriptionRef: 'sub_test',
      now: new Date('2026-06-09T00:00:00Z'),
    })

    const row = await unsafeDb.clientMembership.findUniqueOrThrow({ where: { id: 'mb_m1' } })
    expect(row.status).toBe('PAST_DUE')
    expect(row.pastDueSince?.toISOString()).toBe(first.toISOString())
  })

  it('clears the clock when the payment recovers', async () => {
    // A membership that recovers must not be cancelled three weeks after a
    // failure it has already fixed.
    await membership({ status: 'PAST_DUE', pastDueSince: PERIOD_START })
    await applySubscriptionEvent({
      type: 'invoice.payment_succeeded',
      subscriptionRef: 'sub_test',
      currentPeriodEnd: '2026-08-01T00:00:00Z',
      now: NOW,
    })

    const row = await unsafeDb.clientMembership.findUniqueOrThrow({ where: { id: 'mb_m1' } })
    expect(row.status).toBe('ACTIVE')
    expect(row.pastDueSince).toBeNull()
  })

  it('ends it when the provider says it is gone', async () => {
    await membership()
    await applySubscriptionEvent({
      type: 'customer.subscription.deleted',
      subscriptionRef: 'sub_test',
      now: NOW,
    })
    expect(
      (await unsafeDb.clientMembership.findUniqueOrThrow({ where: { id: 'mb_m1' } })).status,
    ).toBe('CANCELLED')
  })

  it('says so rather than throwing for a reference it does not know', async () => {
    // The platform's own subscription events arrive on the same endpoint.
    expect(
      await applySubscriptionEvent({ type: 'invoice.payment_failed', subscriptionRef: 'sub_nope' }),
    ).toEqual({ handled: false })
  })
})

describe('changing and stopping', () => {
  it('credits what is left of the old plan against the new one', async () => {
    await membership()
    const { proration } = await changePlan({
      salonId: S,
      membershipId: 'mb_m1',
      newPlanId: 'mb_plus',
      now: NOW,
    })

    // Halfway through a month, £30 to £50.
    expect(proration.creditCents).toBeGreaterThan(0)
    expect(proration.netCents).toBeGreaterThan(0)
    expect(
      (await unsafeDb.clientMembership.findUniqueOrThrow({ where: { id: 'mb_m1' } })).planId,
    ).toBe('mb_plus')
  })

  it('does not restart the period on an upgrade', async () => {
    /*
     * A client who upgrades on the 20th has already paid to the end of the
     * month. Resetting the clock charges them a fresh period on top of the
     * difference they just settled — the double-charge every subscription
     * complaint is about.
     */
    await membership()
    await changePlan({ salonId: S, membershipId: 'mb_m1', newPlanId: 'mb_plus', now: NOW })

    const row = await unsafeDb.clientMembership.findUniqueOrThrow({ where: { id: 'mb_m1' } })
    expect(row.currentPeriodStart?.toISOString()).toBe(PERIOD_START.toISOString())
    expect(row.renewsAt?.toISOString()).toBe(PERIOD_END.toISOString())
  })

  it('lets them keep what they paid for when they cancel', async () => {
    await membership()
    const { endsAt } = await cancelMembership({ salonId: S, membershipId: 'mb_m1', now: NOW })

    expect(endsAt?.toISOString()).toBe(PERIOD_END.toISOString())
    const row = await unsafeDb.clientMembership.findUniqueOrThrow({ where: { id: 'mb_m1' } })
    expect(row.status).toBe('ACTIVE')
    expect(row.cancelAtPeriodEnd).toBe(true)

    // And the benefits still work until then.
    expect((await benefitsForBill(S, 'mb_cli', [line('mb_cut', 5_000)], NOW))?.totalCents).toBe(5_000)
  })

  it('ends it there and then when somebody deliberately says so', async () => {
    await membership()
    await cancelMembership({ salonId: S, membershipId: 'mb_m1', immediately: true, now: NOW })
    expect(
      (await unsafeDb.clientMembership.findUniqueOrThrow({ where: { id: 'mb_m1' } })).status,
    ).toBe('CANCELLED')
  })
})

describe('the sweeps, which are the half that makes it real', () => {
  it('ends a cancelled membership once its period runs out', async () => {
    /*
     * Without this the flag is set and nothing acts on it — a client still
     * being charged for something they told the salon to stop.
     */
    await membership({ cancelAtPeriodEnd: true })
    const { ended } = await sweepCancellations(new Date('2026-07-02T00:00:00Z'))

    expect(ended).toBe(1)
    expect(
      (await unsafeDb.clientMembership.findUniqueOrThrow({ where: { id: 'mb_m1' } })).status,
    ).toBe('CANCELLED')
  })

  it('leaves it alone until the period actually ends', async () => {
    await membership({ cancelAtPeriodEnd: true })
    expect((await sweepCancellations(NOW)).ended).toBe(0)
  })

  it('gives up on an overdue card after three weeks, not before', async () => {
    await membership({ status: 'PAST_DUE', pastDueSince: PERIOD_START })

    expect((await sweepDunning(new Date('2026-06-10T00:00:00Z'))).cancelled).toBe(0)
    expect((await sweepDunning(new Date('2026-06-25T00:00:00Z'))).cancelled).toBe(1)
  })
})

describe('what the memberships are worth', () => {
  it('splits the fee into what has been earned and what has not', async () => {
    await membership()

    // Half way through a 30-day period on a 3000 fee.
    const mid = new Date('2026-06-16T00:00:00Z')
    const revenue = await membershipRevenue(S, mid)

    expect(revenue.members).toBe(1)
    expect(revenue.takenCents).toBe(3_000)
    expect(revenue.earnedCents).toBe(1_500)
    expect(revenue.deferredCents).toBe(1_500)
    // The two halves are the whole thing — a rounding error here is money the
    // salon either invents or loses.
    expect(revenue.earnedCents + revenue.deferredCents).toBe(revenue.takenCents)
  })

  it('counts a past-due member, because the service is still owed', async () => {
    await membership({ status: 'PAST_DUE', pastDueSince: new Date('2026-06-14T00:00:00Z') })
    const revenue = await membershipRevenue(S, PERIOD_START)

    expect(revenue.members).toBe(1)
    expect(revenue.deferredCents).toBe(3_000)
  })

  it('leaves a cancelled member out entirely', async () => {
    await membership({ status: 'CANCELLED' })
    expect(await membershipRevenue(S, NOW)).toMatchObject({ members: 0, takenCents: 0 })
  })

  it('normalises a yearly plan to what it brings in each month', async () => {
    await unsafeDb.clientMembershipPlan.update({
      where: { id: 'mb_basic' },
      data: { interval: 'YEAR', priceCents: 36_000 },
    })
    await membership()

    expect((await membershipRevenue(S, NOW)).monthlyRunRateCents).toBe(3_000)
  })

  it('counts an unconfirmed membership towards the run rate but not the money', async () => {
    // No period yet means the provider has not confirmed it. Counting the fee
    // as taken would invent money the salon does not have.
    await membership({ currentPeriodStart: null, renewsAt: null })
    const revenue = await membershipRevenue(S, NOW)

    expect(revenue.monthlyRunRateCents).toBe(3_000)
    expect(revenue.takenCents).toBe(0)
  })
})

describe('a refund undoing the bill', () => {
  async function billed() {
    await membership()
    const benefits = await benefitsForBill(S, 'mb_cli', [line('mb_cut', 5_000)], NOW)
    await unsafeDb.invoice.create({
      data: {
        id: 'mb_inv',
        salonId: S,
        clientProfileId: 'mb_cli',
        number: 'MB-0001',
        status: 'PAID',
        subtotalCents: 5_000,
        discountCents: 5_000,
        totalCents: 0,
      },
    })
    await recordBenefitUse({
      salonId: S,
      membershipId: 'mb_m1',
      invoiceId: 'mb_inv',
      benefits: benefits!.benefits,
    })
    return unsafeDb.payment.create({
      data: {
        id: 'mb_pay',
        salonId: S,
        invoiceId: 'mb_inv',
        clientProfileId: 'mb_cli',
        amountCents: 5_000,
        status: 'SUCCEEDED',
        capturedAt: NOW,
      },
    })
  }

  it('gives the allowance back when the whole bill goes back', async () => {
    await billed()
    await refundPayment({
      salonId: S,
      paymentId: 'mb_pay',
      amountCents: 5_000,
      reason: 'The colour did not take.',
    })

    // They still have their free cut this month. Keeping the allowance for a
    // service they were not, in the end, given is the salon holding something
    // for nothing.
    const again = await benefitsForBill(S, 'mb_cli', [line('mb_cut', 5_000)], NOW)
    expect(again?.totalCents).toBe(5_000)
  })

  it('keeps it on a partial refund, which would otherwise be spendable twice', async () => {
    await billed()
    await refundPayment({
      salonId: S,
      paymentId: 'mb_pay',
      amountCents: 1_000,
      reason: 'Goodwill for the wait.',
    })

    const again = await benefitsForBill(S, 'mb_cli', [line('mb_cut', 5_000)], NOW)
    expect(again?.totalCents).toBe(0)
  })

  it('releases once partial refunds add up to the whole bill', async () => {
    await billed()
    await refundPayment({ salonId: S, paymentId: 'mb_pay', amountCents: 2_000, reason: 'Part one.' })
    await refundPayment({ salonId: S, paymentId: 'mb_pay', amountCents: 3_000, reason: 'Part two.' })

    const again = await benefitsForBill(S, 'mb_cli', [line('mb_cut', 5_000)], NOW)
    expect(again?.totalCents).toBe(5_000)
  })
})

describe('what the client sees', () => {
  it('shows the plan, the renewal and what is left of the allowance', async () => {
    await membership()
    const view = await membershipFor(S, 'mb_cli', NOW)

    expect(view).toMatchObject({ planName: 'Basic', status: 'ACTIVE', suspended: false })
    expect(view?.entitlements).toHaveLength(1)
    expect(view?.usedThisPeriod).toEqual({})
  })

  it('does not show a cancelled one', async () => {
    await membership({ status: 'CANCELLED' })
    expect(await membershipFor(S, 'mb_cli', NOW)).toBeNull()
  })
})
