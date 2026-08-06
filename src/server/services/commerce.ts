import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import { paymentsPort } from '@/ports/registry'
import { benefitsForBill, recordBenefitUse } from './memberships'
import {
  amountDue,
  computeCancellationFee,
  computeDeposit,
  computeInvoice,
  discountWithinCap,
  type CancellationPolicySnapshot,
  type DepositPolicySnapshot,
  type InvoiceLineInput,
} from '@/domain/commerce/pricing'
import {
  discountAmount,
  repriceAsDiscount,
  type DiscountReasonSpec,
} from '@/domain/commerce/discounts'
import { decideDeposit } from '@/domain/commerce/deposits'
import {
  authorizeDeposit,
  captureDeposit,
  forfeitDeposit,
  markDepositApplied,
  releaseDeposit,
} from '@/server/services/deposits'
import type { DepositBand as RiskBand } from '@/domain/consultation/types'

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
  /**
   * The figure already decided by `quoteDeposit` and frozen onto the plan.
   *
   * Passed in rather than recomputed here, so what is charged is exactly what
   * the client was shown at approval. Recomputing at the till would silently
   * re-quote against whatever the policy says today.
   */
  amountCents: number
  currency: string
  /** Recorded with the deposit so "why this much?" survives a policy edit. */
  rationale?: string | null
  refundableUntilHours?: number
}

/**
 * What a deposit comes to, before anybody is asked for it.
 *
 * The single place a deposit becomes a number, and the reason this exists is
 * that there used to be two. The rules engine computed one figure from its own
 * hardcoded percentages and that figure was persisted onto `ServicePlan`; the
 * till computed a different one from the salon's actual policy row. Nothing
 * mapped between them — one band is 0–3 and the other is a string — so a client
 * could be quoted one number and asked for another.
 *
 * Commerce is the authority now. The engine returns risk; this returns money.
 */
export async function quoteDeposit(input: {
  salonId: string
  serviceIds: readonly string[]
  band: RiskBand
  serviceTotalCents: number
}) {
  const [services, salonDefault, settings] = await Promise.all([
    unsafeDb.service.findMany({
      where: { salonId: input.salonId, id: { in: [...input.serviceIds] } },
      select: { isChemical: true, containsDye: true, depositPolicy: true, baseComplexity: true },
    }),
    unsafeDb.depositPolicy.findFirst({ where: { salonId: input.salonId, isDefault: true } }),
    unsafeDb.salonSettings.findUnique({
      where: { salonId: input.salonId },
      select: { depositCapCents: true },
    }),
  ])

  /*
   * The strictest service in the basket sets the policy, mirroring how photo
   * requirements and consultation templates already resolve: a cut booked
   * alongside a colour correction is a colour-correction appointment with a
   * haircut in it. "Strictest" is the most expensive policy, measured at this
   * basket's own total rather than by guessing from the percentage — a flat
   * £100 and 20% are not comparable in the abstract.
   */
  const withPolicy = services.filter((s) => s.depositPolicy)
  const servicePolicy = withPolicy
    .map((s) => toSnapshot(s.depositPolicy!))
    .reduce<DepositPolicySnapshot | null>((strictest, candidate) => {
      if (!strictest) return candidate
      const a = computeDeposit({
        policy: strictest,
        band: 'STANDARD',
        serviceTotalCents: input.serviceTotalCents,
      }).amountCents
      const b = computeDeposit({
        policy: candidate,
        band: 'STANDARD',
        serviceTotalCents: input.serviceTotalCents,
      }).amountCents
      return b > a ? candidate : strictest
    }, null)

  return decideDeposit({
    servicePolicy,
    salonPolicy: salonDefault ? toSnapshot(salonDefault) : null,
    band: input.band,
    isChemical: services.some((s) => s.isChemical || s.containsDye),
    serviceTotalCents: input.serviceTotalCents,
    capCents: settings?.depositCapCents ?? undefined,
  })
}

/**
 * Ask for the deposit the plan already says is owed.
 *
 * This used to mark a deposit AUTHORIZED the moment it created an intent that
 * had no card behind it — a hold nobody had agreed to, recorded as if they
 * had. And it treated a PENDING row as "already taken" and returned early, so
 * the PENDING row `bookDirect` writes at booking time permanently blocked its
 * own charge. Both are gone.
 *
 * There are now two honest paths, and which one runs depends on one fact:
 * whether this client has a card on file.
 *
 *   With a card   the deposit is authorised off-session there and then, and
 *                 comes back AUTHORIZED (or FAILED, with the bank's reason).
 *   Without one   an intent is created and its client secret handed to the
 *                 browser. The row stays PENDING until the client actually
 *                 confirms, because a deposit is not taken until it is taken.
 */
export async function takeDeposit(input: TakeDepositInput): Promise<{
  depositId: string | null
  amountCents: number
  clientSecret: string | null
  status: string
}> {
  /*
   * The policy is loaded to be SNAPSHOTTED, not to decide the amount. What is
   * charged was decided by `quoteDeposit` at approval and frozen onto the plan;
   * this records the terms it was decided under, so a client who agreed to a
   * 48-hour refund window in February keeps February's window.
   */
  const policy = await resolveDepositPolicy(input.salonId, input.servicePlanId)
  const result = {
    amountCents: Math.max(0, Math.round(input.amountCents)),
    rationale: input.rationale ?? 'Deposits go towards the cost of your appointment.',
    refundableUntilHours: input.refundableUntilHours ?? policy.refundableUntilHours ?? 48,
  }

  if (result.amountCents < CENTS) {
    return { depositId: null, amountCents: 0, clientSecret: null, status: 'NONE' }
  }

  const existing = await unsafeDb.deposit.findFirst({
    where: {
      salonId: input.salonId,
      clientProfileId: input.clientProfileId,
      servicePlanId: input.servicePlanId ?? null,
      status: { in: ['PENDING', 'AUTHORIZED', 'CAPTURED'] },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Money already held or taken. Asking again would be a second charge.
  if (existing && existing.status !== 'PENDING') {
    return {
      depositId: existing.id,
      amountCents: existing.amountCents,
      clientSecret: null,
      status: existing.status,
    }
  }

  const deposit =
    existing ??
    (await unsafeDb.deposit.create({
      data: {
        salonId: input.salonId,
        clientProfileId: input.clientProfileId,
        servicePlanId: input.servicePlanId ?? null,
        appointmentId: input.appointmentId ?? null,
        amountCents: result.amountCents,
        // Owed, not held. Nothing has been asked of a card yet.
        status: 'PENDING',
        // Snapshotted so the refund window survives a later policy change.
        policySnapshotJson: { ...policy, rationale: result.rationale } as never,
        refundableUntil: new Date(Date.now() + result.refundableUntilHours * 3_600_000),
      },
    }))

  const card = await unsafeDb.savedCard.findFirst({
    where: { salonId: input.salonId, clientProfileId: input.clientProfileId, detachedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    select: { id: true },
  })

  if (card) {
    const charged = await authorizeDeposit({
      salonId: input.salonId,
      depositId: deposit.id,
      currency: input.currency,
    })
    return {
      depositId: deposit.id,
      amountCents: deposit.amountCents,
      clientSecret: null,
      status: charged.status,
    }
  }

  /*
   * Keyed on what is being paid for, not on when. A retry of the same booking
   * returns the same intent; a genuinely new booking gets a new one.
   */
  const intent = await paymentsPort().createIntent({
    amountCents: deposit.amountCents,
    currency: input.currency.toLowerCase(),
    // Authorised, not captured: the money is held, and taking it only happens
    // if the client does not turn up.
    captureMethod: 'manual',
    idempotencyKey: `dep_${deposit.id}`,
    metadata: {
      salonId: input.salonId,
      depositId: deposit.id,
      servicePlanId: input.servicePlanId ?? '',
    },
  })

  await unsafeDb.deposit.update({
    where: { id: deposit.id },
    data: { providerIntentId: intent.id },
  })

  /*
   * Still PENDING. The client has a secret and an intent, and neither is a
   * payment — the webhook moves this to AUTHORIZED when the provider says the
   * card actually agreed.
   */
  return {
    depositId: deposit.id,
    amountCents: deposit.amountCents,
    clientSecret: intent.clientSecret,
    status: 'PENDING',
  }
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
/**
 * A line the front desk added or changed, as the till sends it.
 *
 * `serviceId` names an existing service line to reprice; its absence means a
 * brand-new line. Kept as one shape rather than two, because the till edits
 * both in the same list and splitting them would mean two round trips to
 * produce one bill.
 */
export interface TillLineInput {
  /** Present for an existing service line the desk repriced. */
  appointmentServiceId?: string | null
  description: string
  quantity: number
  unitPriceCents: number
  kind?: 'SERVICE' | 'RETAIL' | 'FEE' | 'GIFT_CARD'
  /** Sold to this client, for a GIFT_CARD line. */
  giftCardCode?: string | null
}

export interface BuildInvoiceInput {
  salonId: string
  appointmentId: string
  /** Ad-hoc lines and repriced ones. Absent means bill exactly what was agreed. */
  lines?: readonly TillLineInput[]
  orderDiscountCents?: number
  discountReasonId?: string | null
  discountNote?: string | null
  discountApprovedByUserId?: string | null
  tipCents?: number
  taxRateBps?: number
}

/**
 * What the bill comes to, without writing anything.
 *
 * Split out so the permission layer can check a discount against the REAL
 * subtotal before the invoice exists. The cap used to be checked against
 * `appointment.estimatedTotalCents`, which happened to equal the subtotal only
 * because nothing could yet change a line — the moment ad-hoc lines and
 * editable prices ship, that equality is gone and the cap would be enforced
 * against a number that is not on the bill.
 */
export async function priceInvoice(input: BuildInvoiceInput) {
  const appointment = await unsafeDb.appointment.findFirst({
    where: { id: input.appointmentId, salonId: input.salonId },
    include: {
      services: { include: { service: { select: { name: true } } } },
      deposits: true,
      invoice: { select: { id: true } },
    },
  })
  if (!appointment) throw new DomainError('NOT_FOUND', 'That appointment no longer exists.')

  const taxRateBps = input.taxRateBps ?? 0

  /*
   * The agreed price of each service line, keyed so a repriced line can be
   * measured against what the client actually agreed to. That difference is
   * what counts toward the discount cap — otherwise "edit the price to zero"
   * is an unlimited discount with none of the checks.
   */
  const agreed = new Map(appointment.services.map((row) => [row.id, row.priceCents]))

  /** Which catalogue service each appointment line is, for membership benefits. */
  const serviceOf = new Map(appointment.services.map((row) => [row.id, row.serviceId]))

  const supplied = input.lines ?? null
  const rows: (InvoiceLineInput & {
    kind: 'SERVICE' | 'RETAIL' | 'FEE' | 'GIFT_CARD'
    agreedUnitPriceCents: number | null
    giftCardCode: string | null
    serviceId: string | null
  })[] = supplied
    ? supplied.map((line) => {
        const agreedCents = line.appointmentServiceId
          ? (agreed.get(line.appointmentServiceId) ?? null)
          : null
        return {
          description: line.description,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          taxRateBps: line.kind === 'GIFT_CARD' ? 0 : taxRateBps,
          kind: line.kind ?? (line.appointmentServiceId ? 'SERVICE' : 'RETAIL'),
          agreedUnitPriceCents: agreedCents,
          giftCardCode: line.giftCardCode ?? null,
          serviceId: line.appointmentServiceId
            ? (serviceOf.get(line.appointmentServiceId) ?? null)
            : null,
        }
      })
    : appointment.services.map((row) => ({
        description: row.service.name,
        quantity: 1,
        unitPriceCents: row.priceCents,
        taxRateBps,
        kind: 'SERVICE' as const,
        agreedUnitPriceCents: row.priceCents,
        giftCardCode: null,
        serviceId: row.serviceId,
      }))

  /*
   * What the client's membership takes off, before anything else is worked out.
   *
   * Applied as a per-line discount rather than by lowering the price, for two
   * reasons. The receipt has to be able to say "£50, less your membership" —
   * a membership that silently lowers a price reads as a pricing error to the
   * person paying, and watching it work is the reason they keep paying the fee.
   * And it deliberately does NOT count toward the discount cap: an entitlement
   * somebody has already bought is not a discretionary discount for the front
   * desk to be limited on.
   */
  const membership = await benefitsForBill(
    input.salonId,
    appointment.clientProfileId,
    rows.map((row) => ({
      serviceId: row.serviceId,
      description: row.description,
      quantity: row.quantity,
      unitPriceCents: row.unitPriceCents,
    })),
  )

  for (const benefit of membership?.benefits ?? []) {
    const row = rows[benefit.lineIndex]
    if (row) row.discountCents = (row.discountCents ?? 0) + benefit.discountCents
  }

  const totals = computeInvoice({
    lines: rows,
    orderDiscountCents: input.orderDiscountCents,
    tipCents: input.tipCents,
  })

  /*
   * A price edited BELOW what the client agreed is a discount by another name,
   * and is counted as one. Edited above is not a discount at all — it is the
   * colour that took two extra bowls — so it is left to the audit trail rather
   * than to the cap.
   */
  const repricedDownCents = rows.reduce(
    (sum, row) =>
      row.agreedUnitPriceCents == null
        ? sum
        : sum +
          repriceAsDiscount({
            agreedCents: row.agreedUnitPriceCents * Math.max(0, row.quantity),
            chargedCents: Math.round(row.unitPriceCents * Math.max(0, row.quantity)),
          }),
    0,
  )

  /*
   * A deposit counts against this bill while it is still held or already
   * taken. An APPLIED one has been spent on a bill already and a FORFEITED one
   * was kept for an appointment nobody came to — neither is this client's
   * money to be credited twice.
   */
  /*
   * A corrective consultation was paid for before this work was booked, and
   * crediting it here is what keeps it from being a fee — the client pays for
   * the assessment only if they walk away. It hangs off the consultation
   * rather than the appointment, so it does not appear in `deposits` above.
   */
  const consultationDeposits = appointment.consultationId
    ? await unsafeDb.deposit.findMany({
        where: {
          salonId: input.salonId,
          consultationId: appointment.consultationId,
          appointmentId: null,
          status: { in: ['AUTHORIZED', 'CAPTURED'] },
        },
      })
    : []

  const heldDeposits = [
    ...appointment.deposits.filter((d) => d.status === 'AUTHORIZED' || d.status === 'CAPTURED'),
    ...consultationDeposits,
  ]
  const depositHeld = heldDeposits.reduce((sum, d) => sum + d.amountCents, 0)

  return {
    appointment,
    rows,
    totals,
    membership,
    heldDeposits,
    depositHeld,
    repricedDownCents,
    /*
     * Everything the cap has to be measured against: given away, however.
     *
     * Membership benefits are subtracted back out. They are already in
     * `totals.discountCents` because that is how they reach the receipt, but a
     * cap on what the front desk may give away must not be spent by an
     * entitlement the client bought — otherwise selling memberships slowly
     * removes the desk's ability to fix anything.
     */
    discountedCents:
      totals.discountCents + repricedDownCents - (membership?.totalCents ?? 0),
    dueCents: amountDue({ totalCents: totals.totalCents, depositAppliedCents: depositHeld }),
  }
}

export async function buildInvoice(
  input: BuildInvoiceInput,
): Promise<{ invoiceId: string; totalCents: number; dueCents: number }> {
  const priced = await priceInvoice(input)
  const { appointment, rows, totals, depositHeld, heldDeposits, membership } = priced

  if (appointment.invoice) {
    throw new DomainError('CONFLICT', 'This appointment has already been invoiced.')
  }

  /*
   * Take the held money BEFORE the bill claims it has been taken.
   *
   * `paidCents: depositHeld` below credits the deposit against the invoice.
   * Until Phase 5 that credit was the only thing that ever happened — the
   * authorisation was never captured and the Deposit row never left
   * AUTHORIZED, so the salon handed over a discount and called it a deposit.
   *
   * Capturing first means a card that declines fails the checkout instead of
   * producing an invoice that is short by the deposit. Already-CAPTURED rows
   * are a no-op, so a retried checkout is safe.
   */
  for (const deposit of heldDeposits) {
    await captureDeposit({ salonId: input.salonId, depositId: deposit.id })
  }

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
        discountReasonId: input.discountReasonId ?? null,
        discountNote: input.discountNote ?? null,
        discountApprovedByUserId: input.discountApprovedByUserId ?? null,
        issuedAt: new Date(),
        lines: {
          create: totals.lines.map((line, sequence) => ({
            salonId: input.salonId,
            kind: rows[sequence]?.kind ?? 'RETAIL',
            description: line.description,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            totalCents: line.totalCents,
            // Persisted now rather than recomputed later: the receipt has to be
            // able to say "was 95, now 80" a year after the rates changed.
            discountCents: line.appliedDiscountCents,
            agreedUnitPriceCents: rows[sequence]?.agreedUnitPriceCents ?? null,
            taxRateBps: line.taxRateBps ?? 0,
            sequence,
          })),
        },
      },
      select: { id: true },
    })

    /*
     * A gift card line is a card sold. Issued inside the same transaction as
     * the bill it was sold on, so a card can never exist without the sale that
     * paid for it — and the sale can never exist without the card.
     */
    for (const [index, row] of rows.entries()) {
      if (row.kind !== 'GIFT_CARD') continue
      const faceValue = totals.lines[index]?.totalCents ?? 0
      if (faceValue <= 0) continue

      const code = row.giftCardCode?.trim().toUpperCase() || generateGiftCardCode(created.id, index)
      const card = await tx.giftCard.create({
        data: {
          salonId: input.salonId,
          code,
          initialCents: faceValue,
          purchasedByClientId: appointment.clientProfileId,
          issuedOnInvoiceId: created.id,
        },
        select: { id: true },
      })
      await tx.giftCardEntry.create({
        data: {
          salonId: input.salonId,
          giftCardId: card.id,
          amountCents: faceValue,
          kind: 'ISSUE',
          invoiceId: created.id,
          idempotencyKey: `issue_${created.id}_${index}`,
        },
      })
    }

    return created
  })

  /*
   * The bill exists and has been credited, so the deposits are spent. Marking
   * them APPLIED is what stops the next invoice for this client from finding
   * them still "held" and crediting the same money again.
   */
  for (const deposit of heldDeposits) {
    await markDepositApplied({
      salonId: input.salonId,
      depositId: deposit.id,
      invoiceId: invoice.id,
    })
  }

  /*
   * The allowance is spent once the bill is real, never while it is being
   * built. A till recalculates on every line somebody adds, and counting a use
   * per recalculation would eat a client's free cut while they were still
   * deciding whether to buy a shampoo.
   */
  if (membership && membership.benefits.length > 0) {
    await recordBenefitUse({
      salonId: input.salonId,
      membershipId: membership.membershipId,
      invoiceId: invoice.id,
      benefits: membership.benefits,
    })
  }

  return { invoiceId: invoice.id, totalCents: totals.totalCents, dueCents: priced.dueCents }
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

  /*
   * A refund that takes the whole invoice back gives any membership allowance
   * back with it.
   *
   * `InvoiceStatus.VOID` exists in the schema and nothing has ever written it,
   * so a full refund is what actually undoes a bill here. A client whose visit
   * was refunded still has their free cut this month; keeping the allowance
   * would be the salon holding something for nothing. Partial refunds do not
   * release — the visit happened, the benefit landed on it, and handing it back
   * over a goodwill tenner would let the same benefit be spent twice. Measured
   * against the bill rather than the bill plus tip: a salon that refunds the
   * service and lets the client keep the tip has still undone the bill.
   */
  if (payment.invoiceId && alreadyRefunded + input.amountCents >= payment.amountCents) {
    const { releaseBenefitUse } = await import('./memberships')
    await releaseBenefitUse(input.salonId, payment.invoiceId)
  }

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

  const heldDeposits = appointment.deposits.filter(
    (d) => d.status === 'AUTHORIZED' || d.status === 'CAPTURED',
  )
  const depositHeld = heldDeposits.reduce((sum, d) => sum + d.amountCents, 0)

  const at = input.cancelledAt ?? new Date()
  const outcome = computeCancellationFee({
    policy,
    serviceTotalCents: appointment.estimatedTotalCents,
    scheduledAt: appointment.startsAt,
    cancelledAt: at,
    isNoShow: input.isNoShow,
    depositHeldCents: depositHeld,
  })

  /*
   * What the policy says the cancellation costs, BEFORE the deposit is taken
   * off it. `outcome.feeCents` is the residual still to collect; forfeiting
   * against that figure would keep the deposit and then charge the fee again.
   */
  const grossFeeCents = computeCancellationFee({
    policy,
    serviceTotalCents: appointment.estimatedTotalCents,
    scheduledAt: appointment.startsAt,
    cancelledAt: at,
    isNoShow: input.isNoShow,
  }).feeCents

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

  /*
   * Settle the deposit, which is the half that never happened.
   *
   * `computeCancellationFee` returns the fee NET of the deposit — it has
   * always assumed the deposit would be kept, and nothing ever kept it. Every
   * no-show since this was written left the authorisation to quietly expire.
   *
   * Cancelled in good time    the hold is let go, explicitly rather than left
   *                           to lapse, because a pending charge sitting on a
   *                           statement for a week produces a phone call.
   * Cancelled late, or missed the deposit covers the fee, capped at the fee —
   *                           a £50 deposit against a £30 fee returns £20.
   */
  for (const deposit of heldDeposits) {
    if (outcome.withinWindow) {
      await releaseDeposit({ salonId: input.salonId, depositId: deposit.id })
      continue
    }
    await forfeitDeposit({
      salonId: input.salonId,
      depositId: deposit.id,
      reason: outcome.rationale,
      keepAtMostCents: grossFeeCents,
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

// --- Discount catalogue -----------------------------------------------------

/** The reasons the owner has written, for the dropdown at the till. */
export async function discountReasons(salonId: string) {
  return unsafeDb.discountReason.findMany({
    where: { salonId, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    select: { id: true, label: true, kind: true, value: true, maxCents: true },
  })
}

export async function allDiscountReasons(salonId: string) {
  return unsafeDb.discountReason.findMany({
    where: { salonId },
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { label: 'asc' }],
  })
}

/**
 * What a chosen reason is worth on this bill.
 *
 * The till sends a reason id and, for an OPEN reason, an amount. The money is
 * worked out here from the catalogue row the server loaded — a till that could
 * post its own total could post any total, and this is the screen where that
 * matters most.
 */
export async function resolveDiscount(input: {
  salonId: string
  discountReasonId?: string | null
  requestedCents?: number | null
  subtotalCents: number
}): Promise<{ reason: DiscountReasonSpec | null; amountCents: number }> {
  if (!input.discountReasonId) {
    return { reason: null, amountCents: 0 }
  }

  const row = await unsafeDb.discountReason.findFirst({
    where: { id: input.discountReasonId, salonId: input.salonId, isActive: true },
    select: { id: true, label: true, kind: true, value: true, maxCents: true },
  })
  if (!row) throw new DomainError('INVALID_INPUT', 'That discount is not one of yours.')

  const reason: DiscountReasonSpec = { ...row, kind: row.kind }
  return {
    reason,
    amountCents: discountAmount({
      reason,
      requestedCents: input.requestedCents,
      subtotalCents: input.subtotalCents,
    }),
  }
}

export async function saveDiscountReason(input: {
  salonId: string
  id?: string | null
  label: string
  kind: 'PERCENT' | 'FIXED' | 'OPEN'
  value: number
  maxCents: number | null
  isActive: boolean
  sortOrder: number
}): Promise<{ id: string }> {
  const data = {
    label: input.label.trim(),
    kind: input.kind,
    value: input.value,
    maxCents: input.maxCents,
    isActive: input.isActive,
    sortOrder: input.sortOrder,
  }

  if (input.id) {
    const existing = await unsafeDb.discountReason.findFirst({
      where: { id: input.id, salonId: input.salonId },
      select: { id: true },
    })
    if (!existing) throw new DomainError('NOT_FOUND', 'That discount no longer exists.')
    await unsafeDb.discountReason.update({ where: { id: existing.id }, data })
    return { id: existing.id }
  }

  const created = await unsafeDb.discountReason.create({
    data: { salonId: input.salonId, ...data },
    select: { id: true },
  })
  return created
}

// --- Gift cards -------------------------------------------------------------

/**
 * What is left on a card.
 *
 * Summed from the ledger every time rather than read from a column. A stored
 * balance and a ledger that disagree is an argument with somebody holding a
 * piece of card, and only one of the two sides can be audited.
 */
export async function giftCardBalance(salonId: string, giftCardId: string): Promise<number> {
  const result = await unsafeDb.giftCardEntry.aggregate({
    where: { salonId, giftCardId },
    _sum: { amountCents: true },
  })
  return result._sum.amountCents ?? 0
}

export async function findGiftCard(salonId: string, code: string) {
  const card = await unsafeDb.giftCard.findFirst({
    where: { salonId, code: code.trim().toUpperCase() },
  })
  if (!card) return null
  return { ...card, balanceCents: await giftCardBalance(salonId, card.id) }
}

/**
 * Spend a card against a bill.
 *
 * Written as a Payment with method GIFT_CARD rather than as a negative invoice
 * line. A card is money the salon already took — the sale was revenue when the
 * card was bought, and spending it is settlement, not a discount. Recording it
 * as a negative line would count the same money as revenue twice and make the
 * bill's own subtotal a number the salon never charged.
 */
export async function redeemGiftCard(input: {
  salonId: string
  code: string
  invoiceId: string
  amountCents: number
  currency: string
  idempotencyKey: string
  takenByUserId?: string | null
}): Promise<{ paymentId: string; appliedCents: number; remainingOnCardCents: number }> {
  const card = await unsafeDb.giftCard.findFirst({
    where: { salonId: input.salonId, code: input.code.trim().toUpperCase() },
    select: { id: true, status: true, expiresAt: true },
  })
  if (!card) throw new DomainError('NOT_FOUND', 'No card with that code at this salon.')
  if (card.status !== 'ACTIVE') {
    throw new DomainError('CONFLICT', 'That card is no longer active.')
  }
  if (card.expiresAt && card.expiresAt < new Date()) {
    throw new DomainError('CONFLICT', 'That card has expired.')
  }

  const invoice = await unsafeDb.invoice.findFirst({
    where: { id: input.invoiceId, salonId: input.salonId },
    select: { id: true, totalCents: true, paidCents: true, status: true },
  })
  if (!invoice) throw new DomainError('NOT_FOUND', 'That invoice no longer exists.')
  if (invoice.status === 'PAID') throw new DomainError('CONFLICT', 'That bill is already settled.')

  /*
   * The balance is read and spent under a lock on the card row.
   *
   * Reading the balance and then writing against it is two statements, and two
   * tills running them at once both see the full amount and both spend it —
   * £50 of card settling £100 of bills. The unique index on (card, key) stops
   * a double TAP; only the lock stops a genuine double SPEND, because those
   * carry different keys by design.
   */
  const { applied, remaining, existingPaymentId } = await unsafeDb.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "GiftCard" WHERE id = ${card.id} FOR UPDATE`

    const already = await tx.giftCardEntry.findFirst({
      where: { giftCardId: card.id, idempotencyKey: input.idempotencyKey },
      select: { amountCents: true, paymentId: true },
    })
    const sum = await tx.giftCardEntry.aggregate({
      where: { salonId: input.salonId, giftCardId: card.id },
      _sum: { amountCents: true },
    })
    const balance = sum._sum.amountCents ?? 0

    // A retry: the money already moved. Report what it did rather than doing it
    // again, and leave the balance alone.
    if (already) {
      return {
        applied: Math.abs(already.amountCents),
        remaining: balance,
        existingPaymentId: already.paymentId,
      }
    }

    // Never more than is on the card, and never more than is owed. Both bounds
    // matter: overpaying a bill from a card is how a balance disappears into a
    // salon's takings with nothing to show the client.
    const owed = Math.max(0, invoice.totalCents - invoice.paidCents)
    const take = Math.min(input.amountCents, balance, owed)
    if (take <= 0) {
      throw new DomainError('CONFLICT', 'There is nothing left to apply from that card.')
    }

    await tx.giftCardEntry.create({
      data: {
        salonId: input.salonId,
        giftCardId: card.id,
        amountCents: -take,
        kind: 'REDEEM',
        invoiceId: input.invoiceId,
        idempotencyKey: input.idempotencyKey,
        createdByUserId: input.takenByUserId ?? null,
      },
    })

    const left = balance - take
    if (left <= 0) {
      await tx.giftCard.update({ where: { id: card.id }, data: { status: 'REDEEMED' } })
    }

    return { applied: take, remaining: left, existingPaymentId: null as string | null }
  })

  /*
   * The payment is taken outside the lock, and carries the same key, so a
   * retry of the whole call is a lookup on both sides rather than a second
   * charge. Holding a row lock across a call to the payments provider would
   * block every other till on that card for as long as the network takes.
   */
  const payment = await takePayment({
    salonId: input.salonId,
    invoiceId: input.invoiceId,
    amountCents: applied,
    method: 'GIFT_CARD',
    currency: input.currency,
    idempotencyKey: input.idempotencyKey,
    takenByUserId: input.takenByUserId ?? null,
  })

  if (!existingPaymentId) {
    await unsafeDb.giftCardEntry.updateMany({
      where: { giftCardId: card.id, idempotencyKey: input.idempotencyKey },
      data: { paymentId: payment.paymentId },
    })
  }

  return { paymentId: payment.paymentId, appliedCents: applied, remainingOnCardCents: remaining }
}

/**
 * A code somebody can read down a phone.
 *
 * No O/0 or I/1, for the same reason the join code leaves them out: a card is
 * read aloud at a till, and a digit somebody hears wrong is a card that does
 * not exist. Derived from the invoice rather than random, so re-running a
 * failed transaction produces the same code instead of a second card.
 */
function generateGiftCardCode(seed: string, index: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let hash = 2_166_136_261 ^ index
  for (const char of seed) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16_777_619) >>> 0
  }
  let code = ''
  for (let i = 0; i < 10; i++) {
    code += alphabet[hash % alphabet.length]
    hash = Math.imul(hash, 16_777_619) >>> 0
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`
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
