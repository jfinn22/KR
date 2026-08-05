import { percentOf } from './pricing'

/**
 * Why a bill is less than the price list says.
 *
 * The till had a free-text amount and nothing else — so "£30 off" went onto
 * the record with no reason attached, and a month later nobody could tell a
 * staff discount from a goodwill gesture from a colour that had to be redone.
 * Those are three different facts about a salon and only one of them is a
 * problem worth fixing.
 *
 * A typed catalogue the owner writes turns the question from "how much?" into
 * "what happened?", which is the question a manager can actually act on. The
 * amount follows from the reason.
 */

export type DiscountKind = 'PERCENT' | 'FIXED' | 'OPEN'

export interface DiscountReasonSpec {
  id: string
  label: string
  kind: DiscountKind
  /** PERCENT: basis points. FIXED: cents. OPEN: unused. */
  value: number
  /** A ceiling the owner sets per reason, independent of the role cap. */
  maxCents: number | null
}

export interface DiscountRequest {
  reason: DiscountReasonSpec
  /** Only read for OPEN, where the person at the till names the amount. */
  requestedCents?: number | null
  subtotalCents: number
}

/**
 * What this reason is worth on this bill.
 *
 * Pure, and never trusted from the browser: the till sends a reason id and,
 * for an open reason, an amount — the money is worked out here from the
 * catalogue row the server loaded. A client that posts its own total is a
 * client that can post any total.
 */
export function discountAmount(request: DiscountRequest): number {
  const { reason, subtotalCents } = request
  const raw =
    reason.kind === 'PERCENT'
      ? percentOf(subtotalCents, reason.value)
      : reason.kind === 'FIXED'
        ? reason.value
        : Math.max(0, Math.round(request.requestedCents ?? 0))

  const ceiling = reason.maxCents == null ? raw : Math.min(raw, reason.maxCents)
  // Never more than the bill. A discount larger than the total is a refund
  // wearing a discount's clothes, and it belongs on the refund path where
  // somebody has to give a reason and hold the permission.
  return Math.max(0, Math.min(ceiling, Math.max(0, subtotalCents)))
}

/**
 * How much of a discount this role may give without escalating.
 *
 * Lifted out of `actions/commerce.ts`, where it was a module-local map that
 * nothing could test and nothing else could read. Still a constant rather than
 * salon config: a per-salon cap is a real feature, and it is a different one —
 * this is the floor the platform imposes so a salon cannot accidentally give
 * an assistant the ability to zero a bill.
 */
export const DISCOUNT_CAP_PERCENT: Readonly<Record<string, number>> = Object.freeze({
  OWNER: 100,
  MANAGER: 50,
  FRONT_DESK: 10,
  STYLIST: 10,
  ASSISTANT: 0,
})

export function capPercentFor(role: string | null | undefined): number {
  return DISCOUNT_CAP_PERCENT[role ?? ''] ?? 0
}

/**
 * A price edited at the till, measured as a discount.
 *
 * Editing a line down to nothing and calling it a price change would otherwise
 * be an unlimited discount with none of the permission checks — the single
 * most obvious way around the cap, and the reason this exists. Anything below
 * what the client agreed to counts against the same limit; anything above is
 * not a discount at all, and is left to the audit trail rather than the cap.
 */
export function repriceAsDiscount(input: { agreedCents: number; chargedCents: number }): number {
  return Math.max(0, input.agreedCents - input.chargedCents)
}
