/**
 * Money.
 *
 * Every figure the salon charges is computed here, in integer cents, by pure
 * functions. Two reasons this is not spread across the services:
 *
 *  - Rounding. A percentage of a price rounded in three different places
 *    produces three different totals, and the one the client disputes is
 *    always the one on the receipt.
 *  - Argument. A cancellation fee is the single most contested number a salon
 *    produces. It has to be reproducible from the policy as it stood when the
 *    client agreed to it, which means the policy is an input and never a
 *    lookup.
 *
 * Integer cents throughout. Floating-point money is how a total ends up a
 * penny out and nobody can explain why.
 */

export type DepositMode = 'NONE' | 'FLAT' | 'PERCENT' | 'TIERED'

export interface DepositPolicySnapshot {
  mode: DepositMode
  flatCents?: number | null
  percentBps?: number | null
  minCents?: number | null
  maxCents?: number | null
  refundableUntilHours?: number | null
  /** Band → override, for TIERED. The rules engine picks the band. */
  tiers?: Readonly<Record<string, { percentBps?: number; minCents?: number }>> | null
}

export type DepositBand = 'NONE' | 'LOW' | 'STANDARD' | 'HIGH' | 'FULL_PREPAY'

export interface DepositResult {
  amountCents: number
  /** What the client is told, in one sentence. */
  rationale: string
  refundableUntilHours: number
}

/**
 * What to take up front.
 *
 * The band comes from the rules engine — it knows about no-show history and
 * how expensive the service is to lose — and this turns that judgement into
 * money using the salon's own policy. Splitting it this way means a salon can
 * change its deposit rates without touching risk assessment, and vice versa.
 */
export function computeDeposit(input: {
  policy: DepositPolicySnapshot
  band: DepositBand
  serviceTotalCents: number
  /** The salon's absolute ceiling, whatever the policy says. */
  capCents?: number
}): DepositResult {
  const { policy, band, serviceTotalCents } = input
  const refundableUntilHours = policy.refundableUntilHours ?? 48

  if (band === 'NONE' || policy.mode === 'NONE') {
    return {
      amountCents: 0,
      rationale: 'No deposit needed for this booking.',
      refundableUntilHours,
    }
  }

  if (band === 'FULL_PREPAY') {
    return {
      amountCents: clampCents(serviceTotalCents, 0, input.capCents),
      rationale: 'Paid in full up front, as agreed.',
      refundableUntilHours,
    }
  }

  let amount = 0
  let rationale = ''

  if (policy.mode === 'FLAT') {
    amount = policy.flatCents ?? 0
    rationale = 'A fixed deposit to secure the booking.'
  } else if (policy.mode === 'PERCENT') {
    amount = percentOf(serviceTotalCents, policy.percentBps ?? 0)
    rationale = `${formatBps(policy.percentBps ?? 0)} of the estimate, taken off your final bill.`
  } else {
    // TIERED: the band selects the rate, falling back to the base percentage.
    const tier = policy.tiers?.[band]
    const bps = tier?.percentBps ?? policy.percentBps ?? 0
    amount = percentOf(serviceTotalCents, bps)
    amount = Math.max(amount, tier?.minCents ?? 0)
    rationale = `${formatBps(bps)} of the estimate — this booking holds a long slot.`
  }

  amount = Math.max(amount, policy.minCents ?? 0)
  if (policy.maxCents != null) amount = Math.min(amount, policy.maxCents)

  // Never more than the job is worth: a deposit above the estimate is a bug
  // that reads to a client as a scam.
  amount = Math.min(amount, serviceTotalCents)

  return {
    amountCents: clampCents(amount, 0, input.capCents),
    rationale,
    refundableUntilHours,
  }
}

export interface CancellationPolicySnapshot {
  windowHours: number
  /** Whole percent, matching how a salon states it on a price list. */
  lateCancelPercent: number
  noShowPercent: number
}

export interface CancellationOutcome {
  feeCents: number
  /** True when the client cancelled with enough notice to owe nothing. */
  withinWindow: boolean
  hoursNotice: number
  rationale: string
}

/**
 * What a cancellation costs.
 *
 * Computed from the notice actually given, against the policy as it stood when
 * the client agreed — which is why the policy is passed in rather than read.
 * A salon that tightens its terms in March must not retroactively charge a
 * client who booked in February.
 */
export function computeCancellationFee(input: {
  policy: CancellationPolicySnapshot
  serviceTotalCents: number
  scheduledAt: Date
  cancelledAt: Date
  isNoShow?: boolean
  /** A deposit already taken is applied against the fee, not added to it. */
  depositHeldCents?: number
}): CancellationOutcome {
  const hoursNotice = (input.scheduledAt.getTime() - input.cancelledAt.getTime()) / 3_600_000

  if (input.isNoShow) {
    const fee = percentOf(input.serviceTotalCents, input.policy.noShowPercent * 100)
    return {
      feeCents: Math.max(0, fee - (input.depositHeldCents ?? 0)),
      withinWindow: false,
      hoursNotice,
      rationale: 'Nobody arrived and the time could not be filled.',
    }
  }

  if (hoursNotice >= input.policy.windowHours) {
    return {
      feeCents: 0,
      withinWindow: true,
      hoursNotice,
      rationale: `Cancelled with ${formatHours(hoursNotice)} notice — nothing to pay.`,
    }
  }

  // Cancelling after the appointment started is late, not negative-notice.
  const effective = Math.max(0, hoursNotice)
  const fee = percentOf(input.serviceTotalCents, input.policy.lateCancelPercent * 100)

  return {
    feeCents: Math.max(0, fee - (input.depositHeldCents ?? 0)),
    withinWindow: false,
    hoursNotice: effective,
    rationale:
      `Cancelled with ${formatHours(effective)} notice, inside the ` +
      `${input.policy.windowHours}-hour window.`,
  }
}

export interface InvoiceLineInput {
  description: string
  quantity: number
  unitPriceCents: number
  taxRateBps?: number
  /** Per-line discount, applied before tax. */
  discountCents?: number
}

export interface InvoiceTotals {
  subtotalCents: number
  discountCents: number
  taxCents: number
  tipCents: number
  totalCents: number
  lines: (InvoiceLineInput & { totalCents: number; taxCents: number })[]
}

/**
 * Add up a bill.
 *
 * Tax is computed per line and rounded per line, then summed — not computed on
 * the summed subtotal. The two differ by a cent or two on mixed-rate bills,
 * and per-line is what every tax authority and every accountant expects, so it
 * is what the receipt has to show.
 *
 * The tip is never taxed and never discounted: it is the client's money passing
 * through, not the salon's revenue.
 */
export function computeInvoice(input: {
  lines: readonly InvoiceLineInput[]
  /** Applied across the bill after per-line discounts. */
  orderDiscountCents?: number
  tipCents?: number
}): InvoiceTotals {
  const priced = input.lines.map((line) => {
    const gross = line.unitPriceCents * Math.max(0, line.quantity)
    const discount = Math.min(line.discountCents ?? 0, gross)
    const net = gross - discount
    return {
      ...line,
      totalCents: net,
      taxCents: percentOf(net, line.taxRateBps ?? 0),
    }
  })

  const subtotal = priced.reduce((sum, line) => sum + line.totalCents, 0)
  const lineDiscounts = input.lines.reduce((sum, line) => sum + (line.discountCents ?? 0), 0)
  const orderDiscount = Math.min(input.orderDiscountCents ?? 0, subtotal)

  /*
   * An order-level discount reduces the taxable amount proportionally, so tax
   * is scaled by the same ratio. Discounting the total but taxing the
   * pre-discount lines would overcharge the client — quietly, and on every
   * bill with a voucher on it.
   */
  const ratio = subtotal > 0 ? (subtotal - orderDiscount) / subtotal : 1
  const tax = priced.reduce((sum, line) => sum + Math.round(line.taxCents * ratio), 0)

  const tip = Math.max(0, input.tipCents ?? 0)
  const total = subtotal - orderDiscount + tax + tip

  return {
    subtotalCents: subtotal,
    discountCents: lineDiscounts + orderDiscount,
    taxCents: tax,
    tipCents: tip,
    totalCents: Math.max(0, total),
    lines: priced,
  }
}

/** What is still owed, once a deposit and any part-payments are applied. */
export function amountDue(input: {
  totalCents: number
  depositAppliedCents?: number
  paidCents?: number
}): number {
  return Math.max(0, input.totalCents - (input.depositAppliedCents ?? 0) - (input.paidCents ?? 0))
}

/**
 * Whether a discount is inside what this member of staff may give.
 *
 * Returned rather than thrown, because the front desk needs to know the cap to
 * explain it — "I can do 10%, my manager can do more" is a usable answer and
 * "forbidden" is not.
 */
export function discountWithinCap(input: {
  discountCents: number
  subtotalCents: number
  capPercent: number
}): { allowed: boolean; capCents: number; overByCents: number } {
  const capCents = percentOf(input.subtotalCents, input.capPercent * 100)
  const overByCents = Math.max(0, input.discountCents - capCents)
  return { allowed: overByCents === 0, capCents, overByCents }
}

// --- Helpers ----------------------------------------------------------------

/**
 * Basis points of an amount, rounded half-up.
 *
 * Half-up rather than banker's rounding: it is what a hand calculation
 * produces, and a total a client cannot reproduce on their phone is a total
 * they will argue about.
 */
export function percentOf(amountCents: number, bps: number): number {
  if (bps <= 0 || amountCents <= 0) return 0
  return Math.round((amountCents * bps) / 10_000)
}

function clampCents(value: number, min: number, max?: number): number {
  const lower = Math.max(min, Math.round(value))
  return max === undefined ? lower : Math.min(lower, max)
}

function formatBps(bps: number): string {
  const percent = bps / 100
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`
}

function formatHours(hours: number): string {
  if (hours >= 48) return `${Math.floor(hours / 24)} days`
  if (hours >= 1) return `${Math.floor(hours)} hours`
  return 'under an hour'
}
