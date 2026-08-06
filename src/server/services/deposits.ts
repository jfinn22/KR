import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import { paymentsPort } from '@/ports/registry'
import type { Prisma } from '@prisma/client'

/**
 * The deposit state machine.
 *
 * `DepositStatus` has had seven values since the schema was written and only
 * three were ever written — all of them at row creation, none of them ever
 * updated. `APPLIED`, `FORFEITED` and `REFUNDED` were unreachable, and
 * `authorizationExpiresAt` and `appliedToPaymentId` were columns nothing
 * touched. The lifecycle was a comment.
 *
 * It is a machine now, and the transitions are:
 *
 *   PENDING     a booking that owes a deposit nobody has been asked for yet
 *   AUTHORIZED  the card is held; the money has NOT moved
 *   CAPTURED    the money has moved
 *   APPLIED     captured and credited against a bill
 *   FORFEITED   captured and kept, because nobody turned up
 *   REFUNDED    given back
 *   FAILED      the card said no, and why
 *
 * Two things this file is careful about.
 *
 * The provider decides, not the UI. Every transition that involves money moving
 * either calls the provider first and records what it said, or is driven by a
 * webhook. Nothing here marks a deposit CAPTURED because it hopes it was.
 *
 * And a deposit is credited exactly once. `buildInvoice` already nets a held
 * deposit off the bill through `paidCents`, which happened without the Deposit
 * row knowing — so applying one now marks the row and does NOT credit again.
 * Getting that wrong is a client paying twice, which is the worst bug this
 * system could have.
 */

/** What a transition is allowed to move to. Anything else is a bug, loudly. */
const ALLOWED: Record<string, readonly string[]> = {
  PENDING: ['AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED'],
  // AUTHORIZED back to PENDING is the lapse case, and it is the honest one: a
  // hold that expired means the money is owed again, not that it was refunded.
  AUTHORIZED: ['PENDING', 'CAPTURED', 'APPLIED', 'FORFEITED', 'REFUNDED', 'FAILED'],
  CAPTURED: ['APPLIED', 'FORFEITED', 'REFUNDED'],
  // Terminal. A deposit that has been spent or given back is finished.
  APPLIED: [],
  FORFEITED: ['REFUNDED'],
  REFUNDED: [],
  FAILED: ['AUTHORIZED', 'CAPTURED'],
}

export function canTransition(from: string, to: string): boolean {
  if (from === to) return true
  return (ALLOWED[from] ?? []).includes(to)
}

async function move(
  tx: Prisma.TransactionClient,
  depositId: string,
  to: string,
  data: Prisma.DepositUpdateInput = {},
): Promise<void> {
  const current = await tx.deposit.findUniqueOrThrow({
    where: { id: depositId },
    select: { status: true },
  })
  if (!canTransition(current.status, to)) {
    throw new DomainError(
      'CONFLICT',
      `A deposit cannot go from ${current.status} to ${to}.`,
    )
  }
  await tx.deposit.update({
    where: { id: depositId },
    data: { ...data, status: to as never },
  })
}

/**
 * Ask the card on file for the money, and hold it.
 *
 * Authorised rather than captured, because a deposit taken six weeks out is a
 * promise and not a sale — the money only actually moves if the client does not
 * turn up, or when the bill is settled.
 *
 * `offSession` is not decoration. The client agreed to this when they were at
 * the keyboard adding the card; the provider needs telling that they are not
 * there now, or a bank challenge nobody can answer fails the charge silently.
 */
export async function authorizeDeposit(input: {
  salonId: string
  depositId: string
  currency: string
}): Promise<{ status: string; failureMessage?: string | null }> {
  const deposit = await unsafeDb.deposit.findFirst({
    where: { id: input.depositId, salonId: input.salonId },
    include: { savedCard: true, clientProfile: { select: { paymentsCustomerRef: true } } },
  })
  if (!deposit) throw new DomainError('NOT_FOUND', 'That deposit no longer exists.')
  if (deposit.status !== 'PENDING' && deposit.status !== 'FAILED') {
    return { status: deposit.status }
  }

  const card = deposit.savedCard ?? (await defaultCardFor(input.salonId, deposit.clientProfileId))
  const customerRef = deposit.clientProfile.paymentsCustomerRef
  if (!card || !customerRef) {
    throw new DomainError(
      'CONFLICT',
      'There is no card on file to take this deposit from.',
    )
  }

  /*
   * Keyed on the deposit AND the version of the row being authorised, so a
   * retry of this exact call is a lookup at the provider rather than a second
   * authorisation on somebody's card — while a renewal, which moved the row
   * back to PENDING and therefore bumped `updatedAt`, gets a genuinely new
   * intent instead of being handed back the cancelled one.
   */
  const intent = await paymentsPort().createIntent({
    amountCents: deposit.amountCents,
    currency: input.currency.toLowerCase(),
    captureMethod: 'manual',
    idempotencyKey: `dep_auth_${deposit.id}_${deposit.updatedAt.getTime()}`,
    customerRef,
    paymentMethodRef: card.providerRef,
    offSession: true,
    confirm: true,
    metadata: { salonId: input.salonId, depositId: deposit.id },
  })

  const failed = intent.status === 'FAILED' || intent.status === 'CANCELLED'
  const to = failed ? 'FAILED' : intent.status === 'SUCCEEDED' ? 'CAPTURED' : 'AUTHORIZED'

  await unsafeDb.$transaction(async (tx) => {
    await move(tx, deposit.id, to, {
      providerIntentId: intent.id,
      savedCard: { connect: { id: card.id } },
      // An authorisation is not open-ended. Providers drop them after about a
      // week, and a sweep needs to know when this one goes stale rather than
      // discovering it at capture time with a client in the chair.
      authorizationExpiresAt: failed ? null : new Date(Date.now() + 7 * 86_400_000),
      failureCode: null,
      failureMessage: null,
    })
  })

  return { status: to }
}

/**
 * Turn a hold into money.
 *
 * Split out from applying, and the order the two run in is the whole point.
 * `buildInvoice` credits a held deposit onto the bill through `paidCents`, so
 * the capture has to have already succeeded when that credit is written —
 * otherwise a bill goes in front of a client marked part-paid with money
 * nobody took. Capture first, credit second, mark third.
 *
 * Idempotent: a deposit already CAPTURED is returned as-is.
 */
export async function captureDeposit(input: {
  salonId: string
  depositId: string
}): Promise<{ capturedCents: number; status: string }> {
  const deposit = await unsafeDb.deposit.findFirst({
    where: { id: input.depositId, salonId: input.salonId },
  })
  if (!deposit) throw new DomainError('NOT_FOUND', 'That deposit no longer exists.')
  if (deposit.status !== 'AUTHORIZED') {
    return { capturedCents: deposit.amountCents, status: deposit.status }
  }
  if (!deposit.providerIntentId) {
    throw new DomainError('CONFLICT', 'That deposit was never taken to the provider.')
  }

  const captured = await paymentsPort().capture(deposit.providerIntentId)
  await unsafeDb.$transaction(async (tx) => {
    await move(tx, deposit.id, 'CAPTURED', { authorizationExpiresAt: null })
  })
  return { capturedCents: captured.capturedCents, status: 'CAPTURED' }
}


/**
 * Record which bill consumed this deposit.
 *
 * Separate from the capture because the invoice does not exist yet when the
 * capture has to happen. Already-APPLIED is a no-op rather than an error: a
 * retried checkout must not fail on the half it already finished.
 */
export async function markDepositApplied(input: {
  salonId: string
  depositId: string
  invoiceId: string
  paymentId?: string | null
}): Promise<void> {
  const deposit = await unsafeDb.deposit.findFirst({
    where: { id: input.depositId, salonId: input.salonId },
    select: { id: true, status: true },
  })
  if (!deposit) throw new DomainError('NOT_FOUND', 'That deposit no longer exists.')
  if (deposit.status === 'APPLIED') return

  await unsafeDb.$transaction(async (tx) => {
    await move(tx, deposit.id, 'APPLIED', {
      appliedToPaymentId: input.paymentId ?? null,
      appliedToInvoice: { connect: { id: input.invoiceId } },
    })
  })
}

/**
 * Nobody turned up, and the slot could not be filled.
 *
 * Captures the authorisation and keeps it. This is the one transition a salon
 * has to be able to defend to a client afterwards, which is why the fee that
 * justified it is passed in and recorded rather than recomputed here.
 *
 * `keepAtMostCents` is not a nicety. A £50 deposit against a £30 late-cancel
 * fee is a £20 overcharge if the whole thing is kept, and "the policy says
 * 50%" is not a defence for taking more than 50%. Capturing part of an
 * authorisation releases the rest, so the client is charged the fee and
 * nothing else.
 */
export async function forfeitDeposit(input: {
  salonId: string
  depositId: string
  reason: string
  keepAtMostCents?: number
}): Promise<{ forfeitedCents: number }> {
  const deposit = await unsafeDb.deposit.findFirst({
    where: { id: input.depositId, salonId: input.salonId },
  })
  if (!deposit) throw new DomainError('NOT_FOUND', 'That deposit no longer exists.')
  if (deposit.status === 'FORFEITED') return { forfeitedCents: deposit.amountCents }

  const keep =
    input.keepAtMostCents == null
      ? deposit.amountCents
      : Math.max(0, Math.min(deposit.amountCents, Math.round(input.keepAtMostCents)))

  // Nothing to keep is a release, not a forfeit — and calling it a forfeit
  // would leave a £0 charge on the client's record looking like a penalty.
  if (keep === 0) {
    await releaseDeposit({ salonId: input.salonId, depositId: input.depositId })
    return { forfeitedCents: 0 }
  }

  let forfeitedCents = keep
  if (deposit.status === 'AUTHORIZED' && deposit.providerIntentId) {
    const captured = await paymentsPort().capture(deposit.providerIntentId, keep)
    forfeitedCents = captured.capturedCents || keep
  } else if (deposit.status === 'CAPTURED' && keep < deposit.amountCents && deposit.providerIntentId) {
    // Already taken in full, so the difference has to go back the other way.
    await paymentsPort().refund(
      deposit.providerIntentId,
      deposit.amountCents - keep,
      `dep_partial_${deposit.id}`,
    )
  }

  await unsafeDb.$transaction(async (tx) => {
    if (deposit.status === 'AUTHORIZED') {
      await move(tx, deposit.id, 'CAPTURED', { authorizationExpiresAt: null })
    }
    await move(tx, deposit.id, 'FORFEITED', {
      policySnapshotJson: {
        ...((deposit.policySnapshotJson as object | null) ?? {}),
        forfeitedBecause: input.reason,
        forfeitedCents,
      } as never,
    })
  })

  return { forfeitedCents }
}

/**
 * Let the hold go.
 *
 * A client who cancels with enough notice is owed their money back, and an
 * authorisation that is merely allowed to expire is not the same thing — it
 * leaves a pending charge on their statement for days and produces a phone
 * call. Cancel it explicitly.
 */
export async function releaseDeposit(input: {
  salonId: string
  depositId: string
}): Promise<{ released: boolean }> {
  const deposit = await unsafeDb.deposit.findFirst({
    where: { id: input.depositId, salonId: input.salonId },
  })
  if (!deposit) throw new DomainError('NOT_FOUND', 'That deposit no longer exists.')
  if (deposit.status === 'REFUNDED') return { released: true }

  if (deposit.providerIntentId) {
    if (deposit.status === 'AUTHORIZED') {
      await paymentsPort().cancel(deposit.providerIntentId)
    } else if (deposit.status === 'CAPTURED') {
      // Already taken, so giving it back is a refund rather than a cancel —
      // the provider will not let a captured intent be cancelled, and neither
      // should we.
      await paymentsPort().refund(
        deposit.providerIntentId,
        deposit.amountCents,
        `dep_release_${deposit.id}`,
      )
    }
  }

  await unsafeDb.$transaction(async (tx) => {
    await move(tx, deposit.id, 'REFUNDED')
  })
  return { released: true }
}

/**
 * Charge for a corrective consultation.
 *
 * A corrective assessment is an hour of a senior stylist's time, usually for
 * somebody another salon damaged, and often for a client who then decides not
 * to go ahead. A salon that cannot charge for it either stops offering it or
 * does it at a loss — and stopping offering it is the worse outcome, because
 * the client who most needs a careful assessment is exactly the one who gets
 * turned away.
 *
 * Credited against the work booked from it, which is what keeps it from being
 * a fee: pay for the assessment only if you walk away. `priceInvoice` picks it
 * up through the appointment's `consultationId`.
 *
 * Returns null when the salon has not set a fee, which is the default.
 */
export async function chargeConsultationFee(input: {
  salonId: string
  consultationId: string
  clientProfileId: string
  currency: string
}): Promise<{ depositId: string; amountCents: number; status: string } | null> {
  const settings = await unsafeDb.salonSettings.findUnique({
    where: { salonId: input.salonId },
    select: { correctiveConsultFeeCents: true },
  })
  const amountCents = settings?.correctiveConsultFeeCents ?? 0
  if (amountCents <= 0) return null

  /*
   * One per consultation. A client who edits their answers and resubmits is
   * still having one assessment, and re-evaluation runs on every submit — so
   * without this a hesitant client is charged for their own hesitation.
   */
  const existing = await unsafeDb.deposit.findFirst({
    where: {
      salonId: input.salonId,
      consultationId: input.consultationId,
      status: { in: ['PENDING', 'AUTHORIZED', 'CAPTURED', 'APPLIED'] },
    },
  })
  if (existing) {
    return {
      depositId: existing.id,
      amountCents: existing.amountCents,
      status: existing.status,
    }
  }

  const deposit = await unsafeDb.deposit.create({
    data: {
      salonId: input.salonId,
      clientProfileId: input.clientProfileId,
      consultationId: input.consultationId,
      amountCents,
      status: 'PENDING',
      policySnapshotJson: {
        kind: 'CORRECTIVE_CONSULTATION',
        rationale:
          'Corrective assessments are charged up front and come off the cost of the work.',
      } as never,
    },
    select: { id: true },
  })

  /*
   * Authorised now if there is a card, and left PENDING if there is not. A
   * consultation must never be blocked on payment: the assessment is the thing
   * that tells a client their hair is in trouble, and holding that back until
   * a card clears is indefensible.
   */
  let status = 'PENDING'
  try {
    const charged = await authorizeDeposit({
      salonId: input.salonId,
      depositId: deposit.id,
      currency: input.currency,
    })
    status = charged.status
  } catch {
    // No card on file, most likely. The desk collects it in person.
  }

  return { depositId: deposit.id, amountCents, status }
}

/**
 * Take a fresh hold before the current one lapses.
 *
 * Providers drop an authorisation after about a week, and a deposit taken six
 * weeks out will outlive its own hold several times over. Left alone the salon
 * finds out on the day that the money it was counting on was quietly released
 * a month ago.
 *
 * The old hold is cancelled BEFORE the new one is taken. The other order puts
 * two holds on one card at the same time, which a client reads as being
 * charged twice — and they are not wrong about what their statement says.
 */
export async function renewDepositAuthorization(input: {
  salonId: string
  depositId: string
  currency: string
}): Promise<{ status: string }> {
  const deposit = await unsafeDb.deposit.findFirst({
    where: { id: input.depositId, salonId: input.salonId },
    select: { id: true, status: true, providerIntentId: true },
  })
  if (!deposit) throw new DomainError('NOT_FOUND', 'That deposit no longer exists.')
  if (deposit.status !== 'AUTHORIZED') return { status: deposit.status }

  if (deposit.providerIntentId) {
    try {
      await paymentsPort().cancel(deposit.providerIntentId)
    } catch {
      // Already gone at the provider, which is exactly the state being fixed.
    }
  }

  await unsafeDb.$transaction(async (tx) => {
    await move(tx, deposit.id, 'PENDING', {
      // Cleared, or the new authorisation collides with the old row on the
      // unique index and the renewal fails on its own bookkeeping.
      providerIntentId: null,
      authorizationExpiresAt: null,
    })
  })

  return authorizeDeposit(input)
}

/**
 * What the provider says happened.
 *
 * Called from the webhook route and nowhere else. The provider is the source of
 * truth for payment state — this is the function that makes that sentence in
 * the schema header true rather than aspirational.
 */
export async function reconcileDepositEvent(event: {
  type: string
  objectId: string
  amountCents?: number
  failureCode?: string | null
  failureMessage?: string | null
}): Promise<{ matched: boolean; depositId?: string; status?: string }> {
  const deposit = await unsafeDb.deposit.findUnique({
    where: { providerIntentId: event.objectId },
    select: { id: true, status: true },
  })
  if (!deposit) return { matched: false }

  const to =
    event.type === 'payment_intent.succeeded'
      ? 'CAPTURED'
      : event.type === 'payment_intent.amount_capturable_updated'
        ? 'AUTHORIZED'
        : event.type === 'payment_intent.payment_failed'
          ? 'FAILED'
          : event.type === 'payment_intent.canceled'
            ? 'REFUNDED'
            : null

  if (!to) return { matched: true, depositId: deposit.id, status: deposit.status }

  /*
   * A late or out-of-order delivery must not walk a deposit backwards. An
   * APPLIED deposit receiving a duplicate `succeeded` is not a reason to
   * un-apply it, so an illegal transition is ignored rather than thrown —
   * throwing would make the provider retry forever.
   */
  if (!canTransition(deposit.status, to)) {
    return { matched: true, depositId: deposit.id, status: deposit.status }
  }

  await unsafeDb.deposit.update({
    where: { id: deposit.id },
    data: {
      status: to as never,
      failureCode: event.failureCode ?? null,
      failureMessage: event.failureMessage ?? null,
    },
  })

  return { matched: true, depositId: deposit.id, status: to }
}

async function defaultCardFor(salonId: string, clientProfileId: string) {
  return unsafeDb.savedCard.findFirst({
    where: { salonId, clientProfileId, detachedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  })
}
