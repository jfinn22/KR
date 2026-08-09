'use server'

import { dbFor } from '@/server/db/tenant-client'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import {
  buildInvoice,
  checkDiscount,
  confirmPendingTillPayment,
  priceInvoice,
  redeemGiftCard,
  refundPayment,
  resolveDiscount,
  saveDiscountReason,
  takePayment,
  waiveCancellationFee,
} from '@/server/services/commerce'
import { capPercentFor } from '@/domain/commerce/discounts'
import { can } from '@/domain/authz/policy'
import type { TenantContext } from '@/server/auth/context'

/**
 * Money actions.
 *
 * The permission split here is deliberate and mirrors how a salon actually
 * works: anyone on the desk can take a payment, a discount inside the cap is
 * routine, a discount over it is a manager's call, and a refund is its own
 * permission entirely. The policy layer holds those distinctions; these
 * actions just name them.
 */

const cuid = z.string().min(1).max(64)
const money = z.number().int().min(0).max(10_000_00)

async function appointmentResource(appointmentId: string, ctx: TenantContext) {
  const appointment = await dbFor(ctx.salonId).appointment.findFirst({
    where: { id: appointmentId, salonId: ctx.salonId },
    select: { clientProfileId: true, primaryStylistId: true, locationId: true },
  })
  if (!appointment) throw new DomainError('NOT_FOUND', 'That appointment no longer exists.')
  return {
    salonId: ctx.salonId,
    clientProfileId: appointment.clientProfileId,
    ownerStylistId: appointment.primaryStylistId,
    locationId: appointment.locationId,
  }
}

async function invoiceResource(invoiceId: string, ctx: TenantContext) {
  const invoice = await dbFor(ctx.salonId).invoice.findFirst({
    where: { id: invoiceId, salonId: ctx.salonId },
    select: { clientProfileId: true },
  })
  if (!invoice) throw new DomainError('NOT_FOUND', 'That invoice no longer exists.')
  return { salonId: ctx.salonId, clientProfileId: invoice.clientProfileId }
}

/*
 * Hoisted, for the reason `NEW_CLIENT` is hoisted in `actions/client.ts`: a
 * `'use server'` module may only export async functions, and these are shared
 * between two actions besides.
 */
const TILL_LINE = z.object({
  appointmentServiceId: cuid.nullish(),
  description: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(99),
  unitPriceCents: money,
  kind: z.enum(['SERVICE', 'RETAIL', 'FEE', 'GIFT_CARD']).optional(),
  giftCardCode: z.string().max(40).nullish(),
})

const BILL = z.object({
  appointmentId: cuid,
  /** Ad-hoc lines and repriced ones. Absent bills exactly what was agreed. */
  lines: z.array(TILL_LINE).max(40).optional(),
  discountReasonId: cuid.nullish(),
  /** Only read for an OPEN reason; every other kind computes its own amount. */
  discountRequestedCents: money.optional(),
  /** The written explanation the policy layer demands over the cap. */
  reason: z.string().max(500).optional(),
  tipCents: money.optional(),
})

/**
 * Produce the bill.
 *
 * Two things changed here, and both are about the discount.
 *
 * It runs under `discount.applyWithinCap` / `discount.applyOverCap` rather than
 * `payment.take`. Those two actions have been in the role matrix since it was
 * written and were held by nothing — so "a discount over the cap is a manager's
 * call" was a comment rather than a rule, enforced by a module-local map the
 * matrix could not see and no test could reach.
 *
 * And the cap is measured against the real subtotal, computed before anything
 * is written. It used to be measured against `appointment.estimatedTotalCents`,
 * which was the same number only because nothing could change a line. Ad-hoc
 * lines and editable prices break that equality on purpose, and a cap enforced
 * against a figure that is not on the bill is not a cap.
 */
export const buildInvoiceAction = withAuthz(
  {
    action: 'discount.applyWithinCap',
    schema: BILL,
    resource: (input, ctx) => appointmentResource(input.appointmentId, ctx),
    auditAs: (_input, result) => ({
      entityType: 'Invoice',
      entityId: (result as { invoiceId: string }).invoiceId,
    }),
  },
  async (input, ctx) => {
    const role = ctx.principal.kind === 'staff' ? ctx.principal.role : null

    // Price it first. The permission question needs the answer.
    // Tax is never taken from the till payload — a caller posting taxRateBps: 0
    // would otherwise wipe the salon's rate. Until a salon tax setting exists,
    // pricing uses its built-in default (zero).
    const preview = await priceInvoice({
      salonId: ctx.salonId,
      appointmentId: input.appointmentId,
      lines: input.lines,
      tipCents: input.tipCents,
    })

    const { reason, amountCents: orderDiscountCents } = await resolveDiscount({
      salonId: ctx.salonId,
      discountReasonId: input.discountReasonId,
      requestedCents: input.discountRequestedCents,
      subtotalCents: preview.totals.subtotalCents,
    })

    /*
     * Everything given away, counted together. A price edited below what the
     * client agreed is a discount by another name — leaving it out would make
     * "edit the line to zero" an unlimited discount with none of the checks,
     * which is the most obvious way around a cap there is.
     */
    const givenAway = orderDiscountCents + preview.repricedDownCents

    if (givenAway > 0) {
      const check = await checkDiscount({
        salonId: ctx.salonId,
        subtotalCents: preview.totals.subtotalCents + preview.repricedDownCents,
        discountCents: givenAway,
        capPercent: capPercentFor(role),
      })

      if (!check.allowed) {
        /*
         * Over the cap is not a refusal — it is an escalation. The person at
         * the till has decided something is owed to this client, and a system
         * that only says no gets worked around with cash and no record. Whoever
         * holds `discount.applyOverCap` may do it WITH a written reason, which
         * the guard requires and audits.
         */
        const permitted = can(ctx.principal, 'discount.applyOverCap', {
          salonId: ctx.salonId,
          clientProfileId: preview.appointment.clientProfileId,
        })

        if (!permitted.allowed) {
          throw new DomainError(
            'FORBIDDEN',
            `That is ${formatShort(check.overByCents)} over what you can approve. ` +
              `Your limit on this bill is ${formatShort(check.capCents)} — ask a manager.`,
          )
        }
        if (!input.reason || input.reason.trim().length < 8) {
          throw new DomainError(
            'INVALID_INPUT',
            'A discount over your limit needs a written reason. It goes on the record.',
          )
        }
      }
    }

    const result = await buildInvoice({
      salonId: ctx.salonId,
      appointmentId: input.appointmentId,
      lines: input.lines,
      orderDiscountCents,
      discountReasonId: reason?.id ?? null,
      discountNote: input.reason?.trim() || null,
      discountApprovedByUserId:
        ctx.principal.kind === 'system' ? null : (ctx.principal.userId ?? null),
      tipCents: input.tipCents,
    })

    revalidatePath(`/s/${ctx.salonSlug}/desk`)
    return result
  },
)

/** What the bill would come to, so the till can show it before committing. */
export const previewInvoiceAction = withAuthz(
  {
    action: 'payment.take',
    schema: BILL,
    resource: (input, ctx) => appointmentResource(input.appointmentId, ctx),
  },
  async (input, ctx) => {
    const preview = await priceInvoice({
      salonId: ctx.salonId,
      appointmentId: input.appointmentId,
      lines: input.lines,
      tipCents: input.tipCents,
    })

    const { reason, amountCents } = await resolveDiscount({
      salonId: ctx.salonId,
      discountReasonId: input.discountReasonId,
      requestedCents: input.discountRequestedCents,
      subtotalCents: preview.totals.subtotalCents,
    })

    /*
     * Priced a second time WITH the discount rather than subtracted from the
     * first pass. An order discount reduces the taxable amount proportionally,
     * so simply taking it off the total would leave the undiscounted tax on
     * the bill — the preview and the invoice would then differ by exactly the
     * tax on the discount, which is a number said out loud to somebody
     * standing there with a card in their hand.
     */
    const final =
      amountCents > 0
        ? await priceInvoice({
            salonId: ctx.salonId,
            appointmentId: input.appointmentId,
            lines: input.lines,
            orderDiscountCents: amountCents,
            tipCents: input.tipCents,
          })
        : preview

    const role = ctx.principal.kind === 'staff' ? ctx.principal.role : null
    const givenAway = amountCents + preview.repricedDownCents
    const check = await checkDiscount({
      salonId: ctx.salonId,
      subtotalCents: preview.totals.subtotalCents + preview.repricedDownCents,
      discountCents: givenAway,
      capPercent: capPercentFor(role),
    })

    return {
      subtotalCents: final.totals.subtotalCents,
      discountCents: amountCents,
      repricedDownCents: final.repricedDownCents,
      taxCents: final.totals.taxCents,
      totalCents: final.totals.totalCents,
      dueCents: final.dueCents,
      discountLabel: reason?.label ?? null,
      // So the till can say "this needs a manager" before somebody taps.
      withinCap: check.allowed,
      capCents: check.capCents,
      overByCents: check.overByCents,
    }
  },
)

const formatShort = (cents: number) => (cents / 100).toFixed(2)

/*
 * Hoisted for the same reason `TILL_LINE` and `NEW_CLIENT` are: a `'use
 * server'` module may only EXPORT async functions, and the arrow inside
 * `.refine()` sits in an exported const's initializer. The compiler rejects it
 * outright, and only at build — typecheck and lint both pass.
 */
const DISCOUNT_REASON = z
  .object({
    id: cuid.nullish(),
    label: z.string().min(2, 'Give it a name people will recognise.').max(60),
    kind: z.enum(['PERCENT', 'FIXED', 'OPEN']),
    /** Basis points for PERCENT, cents for FIXED, ignored for OPEN. */
    value: z.number().int().min(0).max(1_000_00),
    maxCents: money.nullish(),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(999).default(0),
  })
  // A percentage over 100 pays the client to come in. The table refuses it
  // too; this is the version that can say so in words.
  .refine((v) => v.kind !== 'PERCENT' || v.value <= 10_000, {
    message: 'A discount cannot be more than 100%.',
    path: ['value'],
  })

/**
 * Spend a gift card against a bill.
 *
 * A payment, not a discount. The card was revenue when it was sold; spending
 * it is settlement. Recording it as a negative line would count the same money
 * twice and leave the bill showing a subtotal the salon never charged.
 */
export const redeemGiftCardAction = withAuthz(
  {
    action: 'payment.take',
    schema: z.object({
      invoiceId: cuid,
      code: z.string().min(4).max(40),
      amountCents: money,
      idempotencyKey: z.string().min(8).max(80),
    }),
    resource: (input, ctx) => invoiceResource(input.invoiceId, ctx),
    auditAs: (input) => ({ entityType: 'Invoice', entityId: input.invoiceId }),
  },
  async (input, ctx) => {
    const result = await redeemGiftCard({
      salonId: ctx.salonId,
      code: input.code,
      invoiceId: input.invoiceId,
      amountCents: input.amountCents,
      currency: ctx.currency,
      idempotencyKey: input.idempotencyKey,
      takenByUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })

    revalidatePath(`/s/${ctx.salonSlug}/desk`)
    return result
  },
)

/**
 * The owner writing the reasons a bill can be less than the price list.
 *
 * Under `settings.manage` rather than a money permission: this is configuration
 * about how the salon runs, not an act of giving anything away. The person who
 * writes "Staff discount — 50%" is not the person who applies it.
 */
export const saveDiscountReasonAction = withAuthz(
  {
    action: 'settings.manage',
    schema: DISCOUNT_REASON,
    auditAs: (_input, result) => ({
      entityType: 'DiscountReason',
      entityId: (result as { id: string } | null)?.id ?? null,
    }),
  },
  async (input, ctx) => {
    const result = await saveDiscountReason({
      salonId: ctx.salonId,
      id: input.id ?? null,
      label: input.label,
      kind: input.kind,
      value: input.value,
      maxCents: input.maxCents ?? null,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    })

    revalidatePath(`/s/${ctx.salonSlug}/admin/settings`)
    return result
  },
)

export const takePaymentAction = withAuthz(
  {
    action: 'payment.take',
    schema: z.object({
      invoiceId: cuid,
      amountCents: money,
      tipCents: money.optional(),
      method: z.enum(['CARD', 'TERMINAL', 'CASH', 'ACCOUNT_CREDIT', 'GIFT_CARD', 'OTHER']),
      /** Minted by the till per attempt; the same value on a retry. */
      idempotencyKey: z.string().min(8).max(80),
    }),
    resource: (input, ctx) => invoiceResource(input.invoiceId, ctx),
    auditAs: (input) => ({ entityType: 'Invoice', entityId: input.invoiceId }),
  },
  async (input, ctx) => {
    const result = await takePayment({
      salonId: ctx.salonId,
      invoiceId: input.invoiceId,
      amountCents: input.amountCents,
      tipCents: input.tipCents,
      method: input.method,
      currency: ctx.currency,
      idempotencyKey: input.idempotencyKey,
      takenByUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })

    revalidatePath(`/s/${ctx.salonSlug}/desk`)
    return result
  },
)

/** Finish a PENDING mock till payment when Stripe.js is not configured. */
export const confirmPendingTillPaymentAction = withAuthz(
  {
    action: 'payment.take',
    schema: z.object({ paymentId: cuid }),
    resource: async (input, ctx) => {
      const payment = await dbFor(ctx.salonId).payment.findFirst({
        where: { id: input.paymentId, salonId: ctx.salonId },
        select: { clientProfileId: true },
      })
      if (!payment) throw new DomainError('NOT_FOUND', 'That payment no longer exists.')
      return { salonId: ctx.salonId, clientProfileId: payment.clientProfileId }
    },
    auditAs: (input) => ({ entityType: 'Payment', entityId: input.paymentId }),
  },
  async (input, ctx) => {
    const result = await confirmPendingTillPayment({
      salonId: ctx.salonId,
      paymentId: input.paymentId,
    })
    revalidatePath(`/s/${ctx.salonSlug}/desk`)
    return result
  },
)

/**
 * Refund.
 *
 * Its own permission and its own reason. Money going back out is the action
 * most worth being able to explain six months later, and the reason is what
 * makes that possible.
 */
export const refundPaymentAction = withAuthz(
  {
    action: 'payment.refund',
    schema: z.object({
      paymentId: cuid,
      amountCents: money,
      reason: z.string().min(8, 'Say why — it goes on the record.').max(500),
    }),
    resource: async (input, ctx) => {
      const payment = await dbFor(ctx.salonId).payment.findFirst({
        where: { id: input.paymentId, salonId: ctx.salonId },
        select: { clientProfileId: true },
      })
      if (!payment) throw new DomainError('NOT_FOUND', 'That payment no longer exists.')
      return { salonId: ctx.salonId, clientProfileId: payment.clientProfileId }
    },
    auditAs: (input) => ({ entityType: 'Payment', entityId: input.paymentId }),
  },
  async (input, ctx) => {
    const result = await refundPayment({
      salonId: ctx.salonId,
      paymentId: input.paymentId,
      amountCents: input.amountCents,
      reason: input.reason,
      issuedByUserId: ctx.principal.kind === 'system' ? null : ctx.principal.userId,
    })

    revalidatePath(`/s/${ctx.salonSlug}/desk`)
    return result
  },
)

/**
 * Waive a cancellation fee.
 *
 * The right call more often than a policy can express — a cancelled train is
 * not the same as forgetting — and the recorded reason is what keeps that
 * judgement from looking like favouritism.
 */
export const waiveFeeAction = withAuthz(
  {
    action: 'fee.waive',
    schema: z.object({
      appointmentId: cuid,
      reason: z.string().min(8, 'Say why — it goes on the record.').max(500),
    }),
    resource: (input, ctx) => appointmentResource(input.appointmentId, ctx),
    auditAs: (input) => ({ entityType: 'CancellationFee', entityId: input.appointmentId }),
  },
  async (input, ctx) => {
    await waiveCancellationFee({
      salonId: ctx.salonId,
      appointmentId: input.appointmentId,
      reason: input.reason,
      userId: ctx.principal.kind === 'system' ? 'system' : ctx.principal.userId,
    })

    revalidatePath(`/s/${ctx.salonSlug}/desk`)
    return { waived: true }
  },
)

