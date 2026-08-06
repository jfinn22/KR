import { describe, expect, it } from 'vitest'
import {
  applyEntitlements,
  dunningAction,
  entitlementsOf,
  prorate,
  recogniseRevenue,
  type BillableLine,
} from '@/domain/commerce/membership'

/**
 * A membership is a promise made in advance, and every hard case here is what
 * happens when circumstances change after the promise. Getting these wrong does
 * not lose a salon a subscription — it loses them the client, because being
 * wrongly charged feels like being cheated.
 */

const cut = (over: Partial<BillableLine> = {}): BillableLine => ({
  serviceId: 'svc_cut',
  description: 'Cut & finish',
  quantity: 1,
  unitPriceCents: 5_000,
  ...over,
})

describe('reading a plan out of an untyped column', () => {
  it('takes the well-formed entries', () => {
    expect(
      entitlementsOf([
        { kind: 'FREE', serviceId: 'svc_cut', label: 'A cut a month', perPeriod: 1 },
        { kind: 'PERCENT_OFF', value: 2_000, label: '20% off colour', serviceId: 'svc_colour' },
      ]),
    ).toHaveLength(2)
  })

  it('drops a malformed entry rather than the whole membership', () => {
    /*
     * `includedJson` is untyped and will eventually hold something hand-edited.
     * A client at the till should not be told their membership does not exist
     * because somebody mistyped a number in an admin form.
     */
    const parsed = entitlementsOf([
      { kind: 'FREE', label: 'A cut a month', serviceId: 'svc_cut' },
      { kind: 'NONSENSE', value: 5 },
      null,
      'not an object',
      { kind: 'PERCENT_OFF', value: 0 },
    ])
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.label).toBe('A cut a month')
  })

  it('is not upset by a column that is not a list at all', () => {
    expect(entitlementsOf(null)).toEqual([])
    expect(entitlementsOf({ kind: 'FREE' })).toEqual([])
  })

  it('reads a missing allowance as unlimited, because salons really sell that', () => {
    expect(entitlementsOf([{ kind: 'FREE', label: 'Blow-dries' }])[0]?.perPeriod).toBeNull()
  })
})

describe('what the membership takes off the bill', () => {
  const free = entitlementsOf([
    { kind: 'FREE', serviceId: 'svc_cut', label: 'A cut a month', perPeriod: 1 },
  ])

  it('covers the service it names', () => {
    expect(applyEntitlements([cut()], free)).toEqual([
      {
        lineIndex: 0,
        label: 'A cut a month',
        discountCents: 5_000,
        entitlementKey: 'svc_cut:FREE:0',
        units: 1,
      },
    ])
  })

  it('spends one allowance per SERVICE, not per line', () => {
    /*
     * The client, and two friends, billed as one line of three. This used to
     * count a single use and discount the whole line — three haircuts given
     * away for one month's fee — because the allowance was counted per row of
     * the bill rather than per head in the chair.
     */
    const benefits = applyEntitlements([cut({ quantity: 3 })], free)
    expect(benefits).toHaveLength(1)
    expect(benefits[0]?.units).toBe(1)
    expect(benefits[0]?.discountCents).toBe(5_000)
  })

  it('covers as many as the allowance runs to, and no more', () => {
    const two = entitlementsOf([
      { kind: 'FREE', serviceId: 'svc_cut', label: 'Two cuts a month', perPeriod: 2 },
    ])
    const benefits = applyEntitlements([cut({ quantity: 3 })], two)
    expect(benefits[0]?.units).toBe(2)
    expect(benefits[0]?.discountCents).toBe(10_000)
  })

  it('covers the whole line where the allowance is unlimited', () => {
    const unlimited = entitlementsOf([
      { kind: 'FREE', serviceId: 'svc_cut', label: 'Cuts whenever' },
    ])
    const benefits = applyEntitlements([cut({ quantity: 3 })], unlimited)
    expect(benefits[0]?.units).toBe(3)
    expect(benefits[0]?.discountCents).toBe(15_000)
  })

  it('leaves anything else alone', () => {
    const benefits = applyEntitlements([cut({ serviceId: 'svc_colour' })], free)
    expect(benefits).toEqual([])
  })

  it('stops once the allowance is used up', () => {
    // Two cuts on one bill against a one-a-month membership is one free cut.
    const benefits = applyEntitlements([cut(), cut()], free)
    expect(benefits).toHaveLength(1)
    expect(benefits[0]?.lineIndex).toBe(0)
  })

  it('remembers what was already used earlier in the period', () => {
    const used = { 'svc_cut:FREE:0': 1 }
    expect(applyEntitlements([cut()], free, used)).toEqual([])
  })

  it('gives the client the better of two benefits, not the salon', () => {
    /*
     * Somebody who could have either 20% or £10 off is entitled to the larger.
     * A till quietly picking the smaller takes money from the person who
     * prepaid for the privilege.
     */
    const both = entitlementsOf([
      { kind: 'PERCENT_OFF', value: 2_000, label: '20% off', serviceId: 'svc_cut' },
      { kind: 'FIXED_OFF', value: 1_500, label: '£15 off', serviceId: 'svc_cut' },
    ])
    // 20% of £50 is £10; the fixed £15 is more.
    expect(applyEntitlements([cut()], both)[0]).toMatchObject({
      label: '£15 off',
      discountCents: 1_500,
    })
  })

  it('never gives back more than the line is worth', () => {
    // A £30 benefit against a £20 service is £20, not £10 of spendable credit.
    const big = entitlementsOf([{ kind: 'FIXED_OFF', value: 3_000, label: '£30 off' }])
    expect(applyEntitlements([cut({ unitPriceCents: 2_000 })], big)[0]?.discountCents).toBe(2_000)
  })

  it('takes one benefit per line and not two', () => {
    // Which applies first, and does the second apply to the reduced price, is a
    // question nobody has an answer to at the counter.
    const stackable = entitlementsOf([
      { kind: 'PERCENT_OFF', value: 2_000, label: '20% off' },
      { kind: 'FIXED_OFF', value: 500, label: '£5 off' },
    ])
    expect(applyEntitlements([cut()], stackable)).toHaveLength(1)
  })

  it('applies a wildcard benefit to anything', () => {
    const anything = entitlementsOf([{ kind: 'PERCENT_OFF', value: 1_000, label: '10% off all' }])
    expect(applyEntitlements([cut({ serviceId: null })], anything)[0]?.discountCents).toBe(500)
  })
})

describe('changing plan partway through', () => {
  const periodStart = new Date('2026-06-01T00:00:00Z')
  const periodEnd = new Date('2026-07-01T00:00:00Z')

  it('credits what is left and charges for the rest', () => {
    // Halfway through, from £30 to £50.
    const p = prorate({
      oldPriceCents: 3_000,
      newPriceCents: 5_000,
      periodStart,
      periodEnd,
      at: new Date('2026-06-16T00:00:00Z'),
    })
    expect(p.creditCents).toBe(1_500)
    expect(p.chargeCents).toBe(2_500)
    expect(p.netCents).toBe(1_000)
  })

  it('hands back a negative on a downgrade rather than hiding it', () => {
    /*
     * Whether the salon refunds it or carries it as credit is theirs to decide.
     * Clamping to zero takes the decision away and makes the client's own
     * arithmetic wrong.
     */
    const p = prorate({
      oldPriceCents: 5_000,
      newPriceCents: 3_000,
      periodStart,
      periodEnd,
      at: new Date('2026-06-16T00:00:00Z'),
    })
    expect(p.netCents).toBeLessThan(0)
  })

  it('charges in full on the first day and nothing on the last', () => {
    const first = prorate({
      oldPriceCents: 0,
      newPriceCents: 5_000,
      periodStart,
      periodEnd,
      at: periodStart,
    })
    expect(first.chargeCents).toBe(5_000)

    const last = prorate({
      oldPriceCents: 0,
      newPriceCents: 5_000,
      periodStart,
      periodEnd,
      at: periodEnd,
    })
    expect(last.chargeCents).toBe(0)
  })

  it('is not thrown by a change dated outside its own period', () => {
    const p = prorate({
      oldPriceCents: 3_000,
      newPriceCents: 5_000,
      periodStart,
      periodEnd,
      at: new Date('2026-08-01T00:00:00Z'),
    })
    expect(p.remainingFraction).toBe(0)
    expect(p.netCents).toBe(0)
  })
})

describe('when the card stops working', () => {
  const failed = new Date('2026-06-01T00:00:00Z')
  const after = (days: number) => new Date(failed.getTime() + days * 86_400_000)

  it('says nothing on the first day, while the provider is still retrying', () => {
    expect(dunningAction(failed, after(0)).stage).toBe('GRACE')
    expect(dunningAction(failed, after(0)).tellClient).toBe(false)
  })

  it('tells them the next day, because an expired card is invisible', () => {
    expect(dunningAction(failed, after(2))).toMatchObject({ stage: 'ASK', tellClient: true })
  })

  it('stops the benefits at a week without cancelling', () => {
    /*
     * A membership that keeps giving away haircuts against a card that does not
     * work is one the salon is paying for. Cancelling that early is a client
     * who has to be re-sold something they already wanted.
     */
    expect(dunningAction(failed, after(8))).toMatchObject({
      stage: 'SUSPEND',
      suspend: true,
      cancel: false,
    })
  })

  it('gives up at three weeks', () => {
    expect(dunningAction(failed, after(22))).toMatchObject({ stage: 'CANCEL', cancel: true })
  })
})

describe('what the salon has actually earned', () => {
  const periodStart = new Date('2026-06-01T00:00:00Z')
  const periodEnd = new Date('2026-07-01T00:00:00Z')

  it('is nothing on the day it is taken', () => {
    /*
     * A month's fee on the first is not a month's revenue on the first — it is
     * a promise to be available for thirty days, and reading it as income books
     * a month that may still have to be refunded.
     */
    const r = recogniseRevenue({ paidCents: 3_000, periodStart, periodEnd, asOf: periodStart })
    expect(r.earnedCents).toBe(0)
    expect(r.deferredCents).toBe(3_000)
  })

  it('is half of it halfway through', () => {
    const r = recogniseRevenue({
      paidCents: 3_000,
      periodStart,
      periodEnd,
      asOf: new Date('2026-06-16T00:00:00Z'),
    })
    expect(r.earnedCents).toBe(1_500)
  })

  it('is all of it at the end, and never more', () => {
    expect(
      recogniseRevenue({ paidCents: 3_000, periodStart, periodEnd, asOf: periodEnd }).earnedCents,
    ).toBe(3_000)
    expect(
      recogniseRevenue({
        paidCents: 3_000,
        periodStart,
        periodEnd,
        asOf: new Date('2027-01-01T00:00:00Z'),
      }),
    ).toEqual({ earnedCents: 3_000, deferredCents: 0 })
  })
})
