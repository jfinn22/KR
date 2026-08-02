import { describe, expect, it } from 'vitest'
import {
  amountDue,
  computeCancellationFee,
  computeDeposit,
  computeInvoice,
  discountWithinCap,
  percentOf,
} from '@/domain/commerce/pricing'

/**
 * Money is the most-disputed output the product has. These tests exist to make
 * every figure reproducible: a client with a calculator should get the same
 * number the receipt shows, and a cancellation fee should be derivable from the
 * policy the client actually agreed to.
 */

const PERCENT = {
  mode: 'PERCENT' as const,
  percentBps: 2000,
  minCents: 2500,
  refundableUntilHours: 48,
}

describe('deposits', () => {
  it('takes nothing when the band says nothing', () => {
    const result = computeDeposit({
      policy: PERCENT,
      band: 'NONE',
      serviceTotalCents: 22000,
    })
    expect(result.amountCents).toBe(0)
  })

  it('takes a percentage of the estimate', () => {
    const result = computeDeposit({
      policy: PERCENT,
      band: 'STANDARD',
      serviceTotalCents: 22000,
    })
    expect(result.amountCents).toBe(4400)
    expect(result.rationale).toContain('20%')
  })

  it('applies the floor on a small booking', () => {
    const result = computeDeposit({
      policy: PERCENT,
      band: 'STANDARD',
      serviceTotalCents: 6500,
    })
    // 20% of 65.00 is 13.00, below the 25.00 minimum.
    expect(result.amountCents).toBe(2500)
  })

  it('applies the ceiling on a large one', () => {
    const result = computeDeposit({
      policy: { ...PERCENT, maxCents: 15000 },
      band: 'STANDARD',
      serviceTotalCents: 200000,
    })
    expect(result.amountCents).toBe(15000)
  })

  it('respects the salon-wide cap over the policy', () => {
    const result = computeDeposit({
      policy: { ...PERCENT, percentBps: 10000 },
      band: 'HIGH',
      serviceTotalCents: 200000,
      capCents: 50000,
    })
    expect(result.amountCents).toBe(50000)
  })

  // A deposit above the estimate reads to a client as a scam.
  it('never asks for more than the job is worth', () => {
    const result = computeDeposit({
      policy: { mode: 'FLAT', flatCents: 20000, refundableUntilHours: 48 },
      band: 'STANDARD',
      serviceTotalCents: 6500,
    })
    expect(result.amountCents).toBe(6500)
  })

  it('charges the whole thing for full prepay', () => {
    const result = computeDeposit({
      policy: PERCENT,
      band: 'FULL_PREPAY',
      serviceTotalCents: 45000,
    })
    expect(result.amountCents).toBe(45000)
  })

  it('uses the band’s own rate in tiered mode', () => {
    const policy = {
      mode: 'TIERED' as const,
      percentBps: 2000,
      minCents: 0,
      refundableUntilHours: 72,
      tiers: { HIGH: { percentBps: 5000, minCents: 10000 } },
    }
    expect(computeDeposit({ policy, band: 'HIGH', serviceTotalCents: 40000 }).amountCents).toBe(
      20000,
    )
    // A band with no tier entry falls back to the base rate.
    expect(computeDeposit({ policy, band: 'LOW', serviceTotalCents: 40000 }).amountCents).toBe(8000)
  })

  it('carries the refund window through', () => {
    expect(
      computeDeposit({ policy: PERCENT, band: 'STANDARD', serviceTotalCents: 10000 })
        .refundableUntilHours,
    ).toBe(48)
  })
})

describe('cancellation fees', () => {
  const policy = { windowHours: 48, lateCancelPercent: 50, noShowPercent: 100 }
  const scheduledAt = new Date('2026-09-10T14:00:00Z')

  it('charges nothing with enough notice', () => {
    const result = computeCancellationFee({
      policy,
      serviceTotalCents: 22000,
      scheduledAt,
      cancelledAt: new Date('2026-09-07T14:00:00Z'),
    })
    expect(result.feeCents).toBe(0)
    expect(result.withinWindow).toBe(true)
  })

  it('charges the late rate inside the window', () => {
    const result = computeCancellationFee({
      policy,
      serviceTotalCents: 22000,
      scheduledAt,
      cancelledAt: new Date('2026-09-09T14:00:00Z'),
    })
    expect(result.feeCents).toBe(11000)
    expect(result.withinWindow).toBe(false)
    expect(result.rationale).toContain('48-hour window')
  })

  it('charges the full rate for a no-show', () => {
    const result = computeCancellationFee({
      policy,
      serviceTotalCents: 22000,
      scheduledAt,
      cancelledAt: new Date('2026-09-10T15:00:00Z'),
      isNoShow: true,
    })
    expect(result.feeCents).toBe(22000)
  })

  // A deposit already held is applied against the fee, never added to it.
  it('offsets a deposit already taken', () => {
    const result = computeCancellationFee({
      policy,
      serviceTotalCents: 22000,
      scheduledAt,
      cancelledAt: new Date('2026-09-09T14:00:00Z'),
      depositHeldCents: 4400,
    })
    expect(result.feeCents).toBe(11000 - 4400)
  })

  it('never produces a negative fee when the deposit exceeds it', () => {
    const result = computeCancellationFee({
      policy,
      serviceTotalCents: 10000,
      scheduledAt,
      cancelledAt: new Date('2026-09-09T14:00:00Z'),
      depositHeldCents: 9000,
    })
    expect(result.feeCents).toBe(0)
  })

  it('treats cancelling after the start as late, not as negative notice', () => {
    const result = computeCancellationFee({
      policy,
      serviceTotalCents: 10000,
      scheduledAt,
      cancelledAt: new Date('2026-09-10T16:00:00Z'),
    })
    expect(result.hoursNotice).toBe(0)
    expect(result.feeCents).toBe(5000)
  })

  // The point of snapshotting: February's client keeps February's terms.
  it('uses the policy it is given, not a current one', () => {
    const generous = { windowHours: 2, lateCancelPercent: 0, noShowPercent: 50 }
    const result = computeCancellationFee({
      policy: generous,
      serviceTotalCents: 22000,
      scheduledAt,
      cancelledAt: new Date('2026-09-09T14:00:00Z'),
    })
    expect(result.feeCents).toBe(0)
  })
})

describe('invoices', () => {
  it('adds up lines with per-line tax', () => {
    const invoice = computeInvoice({
      lines: [
        { description: 'Balayage', quantity: 1, unitPriceCents: 22000, taxRateBps: 2000 },
        { description: 'Shampoo', quantity: 2, unitPriceCents: 1800, taxRateBps: 2000 },
      ],
    })
    expect(invoice.subtotalCents).toBe(22000 + 3600)
    expect(invoice.taxCents).toBe(4400 + 720)
    expect(invoice.totalCents).toBe(25600 + 5120)
  })

  it('taxes each line at its own rate rather than a blended one', () => {
    const invoice = computeInvoice({
      lines: [
        { description: 'Service', quantity: 1, unitPriceCents: 10000, taxRateBps: 2000 },
        { description: 'Retail', quantity: 1, unitPriceCents: 10000, taxRateBps: 500 },
      ],
    })
    expect(invoice.taxCents).toBe(2000 + 500)
  })

  it('applies a per-line discount before tax', () => {
    const invoice = computeInvoice({
      lines: [
        {
          description: 'Balayage',
          quantity: 1,
          unitPriceCents: 22000,
          taxRateBps: 2000,
          discountCents: 2000,
        },
      ],
    })
    expect(invoice.subtotalCents).toBe(20000)
    expect(invoice.taxCents).toBe(4000)
  })

  /*
   * The bug this prevents is silent and universal: discount the total but tax
   * the pre-discount lines and every voucher overcharges the client.
   */
  it('scales tax down with an order-level discount', () => {
    const invoice = computeInvoice({
      lines: [{ description: 'Balayage', quantity: 1, unitPriceCents: 20000, taxRateBps: 2000 }],
      orderDiscountCents: 5000,
    })
    expect(invoice.taxCents).toBe(3000)
    expect(invoice.totalCents).toBe(20000 - 5000 + 3000)
  })

  it('never taxes or discounts the tip', () => {
    const invoice = computeInvoice({
      lines: [{ description: 'Cut', quantity: 1, unitPriceCents: 6500, taxRateBps: 2000 }],
      orderDiscountCents: 1000,
      tipCents: 1000,
    })
    expect(invoice.tipCents).toBe(1000)
    // Tax on the discounted service only: 20% of 6500 scaled by 5500/6500.
    expect(invoice.taxCents).toBe(1100)
    expect(invoice.totalCents).toBe(6500 - 1000 + 1100 + 1000)
  })

  it('refuses to go negative on an over-large discount', () => {
    const invoice = computeInvoice({
      lines: [{ description: 'Cut', quantity: 1, unitPriceCents: 6500 }],
      orderDiscountCents: 99999,
    })
    expect(invoice.totalCents).toBe(0)
    expect(invoice.discountCents).toBe(6500)
  })

  it('handles an empty bill', () => {
    const invoice = computeInvoice({ lines: [] })
    expect(invoice.totalCents).toBe(0)
    expect(invoice.taxCents).toBe(0)
  })
})

describe('what is still owed', () => {
  it('subtracts the deposit and part-payments', () => {
    expect(amountDue({ totalCents: 22000, depositAppliedCents: 4400, paidCents: 5000 })).toBe(12600)
  })

  it('never goes below zero when overpaid', () => {
    expect(amountDue({ totalCents: 5000, paidCents: 9000 })).toBe(0)
  })
})

describe('discount caps', () => {
  it('allows a discount inside the cap', () => {
    const result = discountWithinCap({ discountCents: 1000, subtotalCents: 20000, capPercent: 10 })
    expect(result.allowed).toBe(true)
    expect(result.capCents).toBe(2000)
  })

  // The front desk needs the number to explain it, not just a refusal.
  it('says how far over the cap a discount is', () => {
    const result = discountWithinCap({ discountCents: 5000, subtotalCents: 20000, capPercent: 10 })
    expect(result.allowed).toBe(false)
    expect(result.capCents).toBe(2000)
    expect(result.overByCents).toBe(3000)
  })
})

describe('rounding', () => {
  it('rounds half up, the way a hand calculation does', () => {
    expect(percentOf(101, 5000)).toBe(51)
    expect(percentOf(1, 5000)).toBe(1)
  })

  it('returns zero rather than a fraction for zero rates', () => {
    expect(percentOf(10000, 0)).toBe(0)
    expect(percentOf(0, 2000)).toBe(0)
  })

  it('never returns a fractional cent', () => {
    for (const amount of [1, 7, 33, 12345, 99999]) {
      for (const bps of [1, 333, 2000, 9999]) {
        expect(Number.isInteger(percentOf(amount, bps))).toBe(true)
      }
    }
  })
})
