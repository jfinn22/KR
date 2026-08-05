import { describe, expect, it } from 'vitest'
import {
  capPercentFor,
  discountAmount,
  repriceAsDiscount,
  type DiscountReasonSpec,
} from '@/domain/commerce/discounts'
import { computeInvoice } from '@/domain/commerce/pricing'

/**
 * Why a bill is less than the price list says.
 *
 * The till had a free-text amount and nothing else, so "£30 off" went onto the
 * record with no reason attached. A month later nobody could tell a staff
 * discount from a goodwill gesture from a colour that had to be redone — three
 * different facts about a salon, and only one of them a problem worth fixing.
 */

const reason = (over: Partial<DiscountReasonSpec> = {}): DiscountReasonSpec => ({
  id: 'r1',
  label: 'Staff',
  kind: 'PERCENT',
  value: 2_000,
  maxCents: null,
  ...over,
})

describe('what a reason is worth', () => {
  it('takes a percentage of the bill', () => {
    expect(discountAmount({ reason: reason(), subtotalCents: 10_000 })).toBe(2_000)
  })

  it('takes a fixed amount regardless of the bill', () => {
    const fixed = reason({ kind: 'FIXED', value: 1_500 })
    expect(discountAmount({ reason: fixed, subtotalCents: 10_000 })).toBe(1_500)
    expect(discountAmount({ reason: fixed, subtotalCents: 90_000 })).toBe(1_500)
  })

  it('lets an open reason be named at the till', () => {
    const open = reason({ kind: 'OPEN' })
    expect(discountAmount({ reason: open, requestedCents: 3_000, subtotalCents: 10_000 })).toBe(
      3_000,
    )
  })

  it('treats an open reason with no amount as nothing', () => {
    expect(discountAmount({ reason: reason({ kind: 'OPEN' }), subtotalCents: 10_000 })).toBe(0)
  })
})

describe('the ceilings', () => {
  it('honours the owner’s per-reason maximum', () => {
    const capped = reason({ value: 5_000, maxCents: 1_000 })
    expect(discountAmount({ reason: capped, subtotalCents: 10_000 })).toBe(1_000)
  })

  /*
   * A discount larger than the bill is a refund wearing a discount's clothes,
   * and it belongs on the refund path where somebody has to give a reason and
   * hold the permission.
   */
  it('never exceeds the bill itself', () => {
    const huge = reason({ kind: 'FIXED', value: 50_000 })
    expect(discountAmount({ reason: huge, subtotalCents: 8_000 })).toBe(8_000)
  })

  it('never goes negative on an empty bill', () => {
    expect(discountAmount({ reason: reason(), subtotalCents: 0 })).toBe(0)
  })

  it('refuses a negative open amount rather than paying the client', () => {
    const open = reason({ kind: 'OPEN' })
    expect(discountAmount({ reason: open, requestedCents: -5_000, subtotalCents: 10_000 })).toBe(0)
  })
})

describe('the role cap', () => {
  it('gives an owner the whole bill and an assistant nothing', () => {
    expect(capPercentFor('OWNER')).toBe(100)
    expect(capPercentFor('ASSISTANT')).toBe(0)
  })

  // A client, a system principal, or a role nobody recognises gets nothing.
  it('defaults an unknown role to nothing rather than to something', () => {
    expect(capPercentFor(null)).toBe(0)
    expect(capPercentFor('WHATEVER')).toBe(0)
  })
})

describe('a price edited at the till', () => {
  /*
   * The most obvious way around a discount cap: leave the discount field empty
   * and edit the line down instead. Counting the difference is what closes it.
   */
  it('counts a reduction as the discount it is', () => {
    expect(repriceAsDiscount({ agreedCents: 9_500, chargedCents: 8_000 })).toBe(1_500)
  })

  it('counts an increase as nothing — that is not a discount', () => {
    expect(repriceAsDiscount({ agreedCents: 9_500, chargedCents: 12_000 })).toBe(0)
  })

  it('counts no change as nothing', () => {
    expect(repriceAsDiscount({ agreedCents: 9_500, chargedCents: 9_500 })).toBe(0)
  })
})

/**
 * Four things `computeInvoice` was getting wrong, each of which becomes
 * reachable the moment the till can add a line or edit a price.
 */
describe('the bill adds up', () => {
  it('reports the discount actually given, not the one asked for', () => {
    // 30 asked for against a line worth 20: only 20 can be taken.
    const totals = computeInvoice({
      lines: [{ description: 'Cut', quantity: 1, unitPriceCents: 2_000, discountCents: 3_000 }],
    })
    expect(totals.subtotalCents).toBe(0)
    // Reporting 3000 here would overstate what the salon gave away, on the
    // figure that gets written to the invoice and read back at month end.
    expect(totals.discountCents).toBe(2_000)
  })

  it('keeps cents whole when a quantity is not', () => {
    const totals = computeInvoice({
      lines: [{ description: 'Toner', quantity: 1.5, unitPriceCents: 1_999 }],
    })
    expect(Number.isInteger(totals.subtotalCents)).toBe(true)
    expect(totals.subtotalCents).toBe(2_999)
  })

  /*
   * A receipt that itemises tax has to add up to the tax on the bill. The
   * per-line figure used to be returned unscaled while the invoice total was
   * scaled by the discount ratio, so the two disagreed on every discounted
   * bill — by exactly the discount.
   */
  it('itemises tax that sums to the tax charged', () => {
    const totals = computeInvoice({
      lines: [
        { description: 'Colour', quantity: 1, unitPriceCents: 10_000, taxRateBps: 2_000 },
        { description: 'Cut', quantity: 1, unitPriceCents: 5_000, taxRateBps: 2_000 },
      ],
      orderDiscountCents: 3_000,
    })

    const itemised = totals.lines.reduce((sum, line) => sum + line.taxCents, 0)
    expect(itemised).toBe(totals.taxCents)
  })

  it('does not turn a credit line into its own discount', () => {
    // A negative line used to be silently zeroed: the clamp picked the negative
    // gross as the "discount", so net came out at exactly nothing.
    const totals = computeInvoice({
      lines: [
        { description: 'Colour', quantity: 1, unitPriceCents: 10_000 },
        { description: 'Goodwill credit', quantity: 1, unitPriceCents: -2_000 },
      ],
    })
    expect(totals.subtotalCents).toBe(8_000)
  })

  it('still adds up with a line discount, an order discount, tax and a tip', () => {
    const totals = computeInvoice({
      lines: [
        {
          description: 'Colour',
          quantity: 1,
          unitPriceCents: 10_000,
          taxRateBps: 2_000,
          discountCents: 1_000,
        },
      ],
      orderDiscountCents: 900,
      tipCents: 500,
    })

    expect(totals.subtotalCents).toBe(9_000)
    expect(totals.discountCents).toBe(1_900)
    expect(totals.taxCents).toBe(1_620)
    expect(totals.totalCents).toBe(9_000 - 900 + 1_620 + 500)
  })
})
