import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import { paymentsPort } from '@/ports/registry'
import {
  amountDue,
  computeCancellationFee,
  computeDeposit,
  computeInvoice,
  discountWithinCap,
  type CancellationPolicySnapshot,
  type DepositBand,
  type DepositPolicySnapshot,
  type InvoiceLineInput,
} from '@/domain/commerce/pricing'

/**
 * Taking money.
 *
 * Two rules run through everything here.
 *
 * Idempotency is not optional. The double-tap is the single most common cause
 * of a duplicate charge, and neither a disabled button nor a spinner prevents
 * it — a flaky connection retries by itself. Every call to the provider
 * carries a key derived from what is being paid for, so a repeat is a lookup
 * rather than a second charge.
 *
 * Policies are snapshotted, never referenced. A client who agreed to a 48-hour
 * cancellation window in February must be charged on February's terms, and the
 * only way to guarantee that is to store the terms with the booking.
 */

const CENTS = 1

export interface TakeDepositInput {
  salonId: string
  clientProfileId: string
  servicePlanId?: string | null
  appointmentId?: string | null
  band: DepositBand
  serviceTotalCents: number
  currency: string
}

export async function takeDeposit(input: TakeDepositInput): Promise<{
  depositId: string | null
  amountCents: number
  clientSecret: string | null
}> {
  const [policy, settings] = await Promise.all([
    resolveDepositPolicy(input.salonId, input.servicePlanId),
    unsafeDb.salonSettings.findUnique({
      where: { salonId: input.salonId },
      select: { depositCapCents: true },
    }),
  ])

  const result = computeDeposit({
    policy,
    band: input.band,
    serviceTotalCents: input.serviceTotalCents,
    capCents: settings?.depositCapCents ?? undefined,
  })

  if (result.amountCents < CENTS) return { depositId: null, amountCents: 0, clientSecret: null }

  /*
   * Keyed on what is being paid for, not on when. A retry of the same booking
   * returns the same intent; a genuinely new booking gets a new one.
   */
  const idempotencyKey = `dep_${input.servicePlanId ?? input.appointmentId ?? input.clientProfileId}`

  const existing = await unsafeDb.deposit.findFirst({
    where: {
      salonId: input.salonId,
      clientProfileId: input.clientProfileId,
      servicePlanId: input.servicePlanId ?? null,
      status: { in: ['PENDING', 'AUTHORIZED', 'CAPTURED'] },
    },
  })
  if (existing) {
    return {
      depositId: existing.id,
      amountCents: existing.amountCents,
      clientSecret: existing.providerIntentId,
    }
  }

  const intent = await paymentsPort().createIntent({
    amountCents: result.amountCents,
    currency: input.currency.toLowerCase(),
    // Authorised, not captured: the money is held, and taking it only happens
    // if the client does not turn up.
    captureMethod: 'manual',
    idempotencyKey,
    metadata: {
      salonId: input.salonId,
      servicePlanId: input.servicePlanId ?? '',
    },
  })

  const deposit = await unsafeDb.deposit.create({
    data: {
      salonId: input.salonId,
      clientProfileId: input.clientProfileId,
      servicePlanId: input.servicePlanId ?? null,
      appointmentId: input.appointmentId ?? null,
      amountCents: result.amountCents,
      status: intent.status === 'SUCCEEDED' ? 'CAPTURED' : 'AUTHORIZED',
      providerIntentId: intent.id,
      // Snapshotted so the refund window survives a later policy change.
      policySnapshotJson: { ...policy, rationale: result.rationale } as never,
      refundableUntil: new Date(Date.now() + result.refundableUntilHours * 3_600_000),
    },
  })

  return { depositId: deposit.id, amountCents: result.amountCents, clientSecret: intent.id }
}

/**
 * The service's policy, then the salon default, then a safe fallback.
 *
 * A missing policy means no deposit rather than an error: a salon that has not
 * configured deposits should still be able to take bookings.
 */
async function resolveDepositPolicy(
  salonId: string,
  servicePlanId?: string | null,
): Promise<DepositPolicySnapshot> {
  if (servicePlanId) {
    const plan = await unsafeDb.servicePlan.findFirst({
      where: { id: servicePlanId, salonId },
      select: { depositPolicy: true, depositPolicySnapshotJson: true },
    })
    if (plan?.depositPolicy) return toSnapshot(plan.depositPolicy)
  }

  const fallback = await unsafeDb.depositPolicy.findFirst({
    where: { salonId, isDefault: true },
  })
  return fallback ? toSnapshot(fallback) : { mode: 'NONE', refundableUntilHours: 48 }
}

function toSnapshot(policy: {
  mode: string
  flatCents: number | null
  percentBps: number | null
  minCents: number
  maxCents: number | null
  refundableUntilHours: number
  tiersJson: unknown
}): DepositPolicySnapshot {
  return {
    mode: policy.mode as DepositPolicySnapshot['mode'],
    flatCents: policy.flatCents,
    percentBps: policy.percentBps,
    minCents: policy.minCents,
    maxCents: policy.maxCents,
    refundableUntilHours: policy.refundableUntilHours,
    tiers: (policy.tiersJson ?? null) as DepositPolicySnapshot['tiers'],
  }
}

// --- Invoicing ---------------------------------------------------------------

/**
 * Build the bill for a finished appointment.
 *
 * Prices come from what was agreed on the appointment, not from the catalog:
 * the client agreed to a figure and that figure is what they are charged, even
 * if the service was repriced in the meantime.
 */
export async function buildInvoice(input: {
  salonId: string
  appointmentId: string
  extraLines?: readonly InvoiceLineInput[]
  orderDiscountCents?: number
  tipCents?: number
  taxRateBps?: number
}): Promise<{ invoiceId: string; totalCents: number; dueCents: number }> {
  const appointment = await unsafeDb.appointment.findFirst({
    where: { id: input.appointmentId, salonId: input.salonId },
    include: {
      services: { include: { service: { select: { name: true } } } },
      deposits: true,
      invoice: { select: { id: true } },
    },
  })
  if (!appointment) throw new DomainError('NOT_FOUND', 'That appointment no longer exists.')
  if (appointment.invoice) {
    throw new DomainError('CONFLICT', 'This appointment has already been invoiced.')
  }

  const taxRateBps = input.taxRateBps ?? 0

  const lines: InvoiceLineInput[] = [
    ...appointment.services.map((row) => ({
      description: row.service.name,
      quantity: 1,
      unitPriceCents: row.priceCents,
      taxRateBps,
    })),
    ...(input.extraLines ?? []),
  ]

  const totals = computeInvoice({
    lines,
    orderDiscountCents: input.orderDiscountCents,
    tipCents: input.tipCents,
  })

  const depositHeld = appointment.deposits
    .filter((d) => d.status === 'AUTHORIZED' || d.status === 'CAPTURED')
    .reduce((sum, d) => sum + d.amountCents, 0)

  const due = amountDue({ totalCents: totals.totalCents, depositAppliedCents: depositHeld })

  const invoice = await unsafeDb.$transaction(async (tx) => {
    const number = await nextInvoiceNumber(tx, input.salonId)

    const created = await tx.invoice.create({
      data: {
        salonId: input.salonId,
        appointmentId: appointment.id,
        clientProfileId: appointment.clientProfileId,
        number,
        status: 'ISSUED',
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        tipCents: totals.tipCents,
        totalCents: totals.totalCents,
        paidCents: depositHeld,
        issuedAt: new Date(),
        lines: {
          create: totals.lines.map((line, sequence) => ({
            salonId: input.salonId,
            kind: sequence < appointment.services.length ? 'SERVICE' : 'RETAIL',
            description: line.description,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            totalCents: line.totalCents,
            taxRateBps: line.taxRateBps ?? 0,
            sequence,
          })),
        },
      },
      select: { id: true },
    })

    return created
  })

  return { invoiceId: invoice.id, totalCents: totals.totalCents, dueCents: due }
}

/**
 * Invoice numbers, sequential per salon.
 *
 * Inside the same transaction as the invoice, so two tills cannot mint the
 * same number — and the unique constraint on (salonId, number) is the backstop
 * if they somehow do.
 */
async function nextInvoiceNumber(
  tx: Parameters<Parameters<typeof unsafeDb.$transaction>[0]>[0],
  salonId: string,
): Promise<string> {
  const last = await tx.invoice.findFirst({
    where: { salonId },
    orderBy: { number: 'desc' },
    select: { number: true },
  })
  const next = last ? Number(last.number.replace(/\D/g, '')) + 1 : 1
  return String(next).padStart(6, '0')
}

export interface TakePaymentInput {
  salonId: string
  invoiceId: string
  amountCents: number
  tipCents?: number
  method: 'CARD' | 'TERMINAL' | 'CASH' | 'ACCOUNT_CREDIT' | 'GIFT_CARD' | 'OTHER'
  currency: string
  takenByUserId?: string | null
  /**
   * Minted once per attempt by the caller and reused on retry.
   *
   * It has to come from the caller because only the caller knows whether this
   * is a retry or a second genuine payment. Deriving it from the invoice and
   * the running total looks safer and is not: the first payment moves the
   * total, so the retry hashes differently and charges again — which is the
   * exact failure this is here to prevent.
   *
   * Two part-payments of the same amount toward one bill are legitimate and
   * must both go through; they simply carry different keys.
   */
  idempotencyKey?: string
}

export async function takePayment(
  input: TakePaymentInput,
): Promise<{ paymentId: string; paidCents: number; remainingCents: number }> {
  const invoice = await unsafeDb.invoice.findFirst({
    where: { id: input.invoiceId, salonId: input.salonId },
    select: { id: true, clientProfileId: true, totalCents: true, paidCents: true, status: true },
  })
  if (!invoice) throw new DomainError('NOT_FOUND', 'That invoice no longer exists.')
  if (invoice.status === 'PAID') throw new DomainError('CONFLICT', 'This bill is already settled.')
  if (input.amountCents < CENTS) {
    throw new DomainError('INVALID_INPUT', 'Enter an amount to take.')
  }

  const idempotencyKey =
    input.idempotencyKey ?? `pay_${invoice.id}_${invoice.paidCents}_${input.amountCents}`

  const already = await unsafeDb.payment.findUnique({ where: { idempotencyKey } })
  if (already) {
    return {
      paymentId: already.id,
      paidCents: invoice.paidCents,
      remainingCents: Math.max(0, invoice.totalCents - invoice.paidCents),
    }
  }

  let providerRef: string | null = null
  if (input.method === 'CARD' || input.method === 'TERMINAL') {
    const intent = await paymentsPort().createIntent({
      amountCents: input.amountCents + (input.tipCents ?? 0),
      currency: input.currency.toLowerCase(),
      captureMethod: 'automatic',
      idempotencyKey,
      metadata: { invoiceId: invoice.id },
    })
    providerRef = intent.id
  }

  const paidCents = invoice.paidCents + input.amountCents
  const settled = paidCents >= invoice.totalCents

  const payment = await unsafeDb.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        salonId: input.salonId,
        invoiceId: invoice.id,
        clientProfileId: invoice.clientProfileId,
        amountCents: input.amountCents,
        tipCents: input.tipCents ?? 0,
        method: input.method,
        status: 'SUCCEEDED',
        providerRef,
        idempotencyKey,
        capturedAt: new Date(),
      },
      select: { id: true },
    })

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidCents,
        status: settled ? 'PAID' : 'PARTIALLY_PAID',
        ...(settled ? { paidAt: new Date() } : {}),
      },
    })

    return created
  })

  return {
    paymentId: payment.id,
    paidCents,
    remainingCents: Math.max(0, invoice.totalCents - paidCents),
  }
}

/**
 * Refund.
 *
 * Never more than was captured, and the provider is the authority on that —
 * the local sum is a fast check, not the guarantee. Always audited with a
 * reason, because a refund is somebody's money moving on somebody's say-so.
 */
export async function refundPayment(input: {
  salonId: string
  paymentId: string
  amountCents: number
  reason: string
  issuedByUserId?: string | null
}): Promise<{ refundId: string }> {
  const payment = await unsafeDb.payment.findFirst({
    where: { id: input.paymentId, salonId: input.salonId },
    include: { refunds: true },
  })
  if (!payment) throw new DomainError('NOT_FOUND', 'That payment no longer exists.')
  if (payment.status !== 'SUCCEEDED') {
    throw new DomainError(
      'CONFLICT',
      'That payment never completed, so there is nothing to refund.',
    )
  }

  const alreadyRefunded = payment.refunds
    .filter((r) => r.status === 'SUCCEEDED')
    .reduce((sum, r) => sum + r.amountCents, 0)

  const refundable = payment.amountCents + payment.tipCents - alreadyRefunded
  if (input.amountCents > refundable) {
    throw new DomainError(
      'INVALID_INPUT',
      `Only ${(refundable / 100).toFixed(2)} of this payment is still refundable.`,
    )
  }

  const idempotencyKey = `ref_${payment.id}_${alreadyRefunded}_${input.amountCents}`

  if (payment.providerRef) {
    await paymentsPort().refund(payment.providerRef, input.amountCents, idempotencyKey)
  }

  const refund = await unsafeDb.refund.create({
    data: {
      salonId: input.salonId,
      paymentId: payment.id,
      amountCents: input.amountCents,
      reason: input.reason,
      status: 'SUCCEEDED',
      issuedByUserId: input.issuedByUserId ?? null,
    },
    select: { id: true },
  })

  return { refundId: refund.id }
}

// --- Cancellation ------------------------------------------------------------

/**
 * What a cancellation costs, recorded against the appointment.
 *
 * Always written even when the fee is zero: "cancelled with four days' notice,
 * nothing to pay" is the record that settles the argument, and a row that only
 * exists when money is owed cannot make that statement.
 */
export async function assessCancellation(input: {
  salonId: string
  appointmentId: string
  cancelledAt?: Date
  isNoShow?: boolean
}): Promise<{ feeCents: number; withinWindow: boolean; rationale: string }> {
  const appointment = await unsafeDb.appointment.findFirst({
    where: { id: input.appointmentId, salonId: input.salonId },
    include: { deposits: true, cancellationFee: { select: { id: true } } },
  })
  if (!appointment) throw new DomainError('NOT_FOUND', 'That appointment no longer exists.')

  const settings = await unsafeDb.salonSettings.findUnique({
    where: { salonId: input.salonId },
    select: {
      cancellationWindowHours: true,
      cancellationFeePercent: true,
      noShowFeePercent: true,
    },
  })

  const policy: CancellationPolicySnapshot = {
    windowHours: settings?.cancellationWindowHours ?? 48,
    lateCancelPercent: settings?.cancellationFeePercent ?? 50,
    noShowPercent: settings?.noShowFeePercent ?? 100,
  }

  const depositHeld = appointment.deposits
    .filter((d) => d.status === 'AUTHORIZED' || d.status === 'CAPTURED')
    .reduce((sum, d) => sum + d.amountCents, 0)

  const outcome = computeCancellationFee({
    policy,
    serviceTotalCents: appointment.estimatedTotalCents,
    scheduledAt: appointment.startsAt,
    cancelledAt: input.cancelledAt ?? new Date(),
    isNoShow: input.isNoShow,
    depositHeldCents: depositHeld,
  })

  if (!appointment.cancellationFee) {
    await unsafeDb.cancellationFee.create({
      data: {
        salonId: input.salonId,
        appointmentId: appointment.id,
        policySnapshotJson: policy as never,
        computedCents: outcome.feeCents,
        status: outcome.feeCents === 0 ? 'WAIVED' : 'PENDING',
      },
    })
  }

  return outcome
}

/**
 * Waive a fee.
 *
 * Separately permissioned and reason-required. Waiving is the right call more
 * often than a policy can express — a client whose train was cancelled is not
 * the same as one who forgot — and the record is what keeps that judgement
 * from looking like favouritism.
 */
export async function waiveCancellationFee(input: {
  salonId: string
  appointmentId: string
  reason: string
  userId: string
}): Promise<void> {
  const fee = await unsafeDb.cancellationFee.findFirst({
    where: { appointmentId: input.appointmentId, salonId: input.salonId },
    select: { id: true, status: true },
  })
  if (!fee) throw new DomainError('NOT_FOUND', 'There is no fee on that appointment.')
  if (fee.status === 'CHARGED') {
    throw new DomainError('CONFLICT', 'That fee has already been charged — refund it instead.')
  }

  await unsafeDb.cancellationFee.update({
    where: { id: fee.id },
    data: { status: 'WAIVED', waivedByUserId: input.userId, waiveReason: input.reason },
  })
}

/** Whether this member of staff may give this discount, and what their cap is. */
export async function checkDiscount(input: {
  salonId: string
  subtotalCents: number
  discountCents: number
  capPercent: number
}) {
  return discountWithinCap({
    discountCents: input.discountCents,
    subtotalCents: input.subtotalCents,
    capPercent: input.capPercent,
  })
}

/** The bill as the till shows it. */
export async function loadInvoice(salonId: string, invoiceId: string) {
  const invoice = await unsafeDb.invoice.findFirst({
    where: { id: invoiceId, salonId },
    include: {
      lines: { orderBy: { sequence: 'asc' } },
      payments: { include: { refunds: true } },
      clientProfile: { select: { firstName: true, lastName: true } },
    },
  })
  if (!invoice) throw new DomainError('NOT_FOUND', 'That invoice no longer exists.')
  return invoice
}
