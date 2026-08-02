'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import {
  buildInvoice,
  checkDiscount,
  refundPayment,
  takeDeposit,
  takePayment,
  waiveCancellationFee,
} from '@/server/services/commerce'
import { unsafeDb } from '@/server/db/client'
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
  const appointment = await unsafeDb.appointment.findFirst({
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
  const invoice = await unsafeDb.invoice.findFirst({
    where: { id: invoiceId, salonId: ctx.salonId },
    select: { clientProfileId: true },
  })
  if (!invoice) throw new DomainError('NOT_FOUND', 'That invoice no longer exists.')
  return { salonId: ctx.salonId, clientProfileId: invoice.clientProfileId }
}

/** How much of a discount this role may give without escalating. */
const DISCOUNT_CAP_PERCENT: Record<string, number> = {
  OWNER: 100,
  MANAGER: 50,
  FRONT_DESK: 10,
  STYLIST: 10,
  ASSISTANT: 0,
}

export const buildInvoiceAction = withAuthz(
  {
    action: 'payment.take',
    schema: z.object({
      appointmentId: cuid,
      orderDiscountCents: money.optional(),
      tipCents: money.optional(),
      taxRateBps: z.number().int().min(0).max(5000).optional(),
      /** Required by the policy layer when the discount exceeds the cap. */
      reason: z.string().max(500).optional(),
    }),
    resource: (input, ctx) => appointmentResource(input.appointmentId, ctx),
    auditAs: (_input, result) => ({
      entityType: 'Invoice',
      entityId: (result as { invoiceId: string }).invoiceId,
    }),
  },
  async (input, ctx) => {
    /*
     * The cap is checked here rather than in the service because it is about
     * who is asking, not about the money. The same discount is fine from a
     * manager and not from an assistant, and only the action layer knows which.
     */
    if (input.orderDiscountCents && input.orderDiscountCents > 0) {
      const role = ctx.principal.kind === 'staff' ? ctx.principal.role : 'ASSISTANT'
      const appointment = await unsafeDb.appointment.findFirstOrThrow({
        where: { id: input.appointmentId, salonId: ctx.salonId },
        select: { estimatedTotalCents: true },
      })

      const check = await checkDiscount({
        salonId: ctx.salonId,
        subtotalCents: appointment.estimatedTotalCents,
        discountCents: input.orderDiscountCents,
        capPercent: DISCOUNT_CAP_PERCENT[role] ?? 0,
      })

      if (!check.allowed) {
        throw new DomainError(
          'FORBIDDEN',
          `That is ${(check.overByCents / 100).toFixed(2)} over what you can approve. ` +
            `Your limit on this bill is ${(check.capCents / 100).toFixed(2)} — ask a manager.`,
        )
      }
    }

    const result = await buildInvoice({
      salonId: ctx.salonId,
      appointmentId: input.appointmentId,
      orderDiscountCents: input.orderDiscountCents,
      tipCents: input.tipCents,
      taxRateBps: input.taxRateBps,
    })

    revalidatePath(`/s/${ctx.salonSlug}/desk`)
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
      const payment = await unsafeDb.payment.findFirst({
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

export const takeDepositAction = withAuthz(
  {
    action: 'payment.take',
    schema: z.object({
      servicePlanId: cuid,
      band: z.enum(['NONE', 'LOW', 'STANDARD', 'HIGH', 'FULL_PREPAY']),
    }),
    resource: async (input, ctx) => {
      const plan = await unsafeDb.servicePlan.findFirst({
        where: { id: input.servicePlanId, salonId: ctx.salonId },
        select: { clientProfileId: true, stylistProfileId: true },
      })
      if (!plan) throw new DomainError('NOT_FOUND', 'That plan no longer exists.')
      return {
        salonId: ctx.salonId,
        clientProfileId: plan.clientProfileId,
        ownerStylistId: plan.stylistProfileId,
      }
    },
  },
  async (input, ctx) => {
    const plan = await unsafeDb.servicePlan.findFirstOrThrow({
      where: { id: input.servicePlanId, salonId: ctx.salonId },
      select: { clientProfileId: true, estimatedTotalCents: true },
    })

    return takeDeposit({
      salonId: ctx.salonId,
      clientProfileId: plan.clientProfileId,
      servicePlanId: input.servicePlanId,
      band: input.band,
      serviceTotalCents: plan.estimatedTotalCents,
      currency: ctx.currency,
    })
  },
)
