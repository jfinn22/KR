import { createHash } from 'node:crypto'
import { unsafeDb } from '@/server/db/client'
import { paymentsPort } from '@/ports/registry'
import { reconcileDepositEvent } from '@/server/services/deposits'
import { syncCards } from '@/server/services/cards'

/**
 * What the provider says happened.
 *
 * The schema header has claimed since it was written that "the provider is the
 * source of truth, reconciled through webhooks". There was no webhook. This is
 * what makes the sentence true.
 *
 * Four things it has to get right, and the order matters:
 *
 *  1. VERIFY FIRST. Nothing is read out of the body until the signature checks
 *     out. This endpoint is unauthenticated by necessity — a provider cannot
 *     hold a session — so the signature is the only thing standing between it
 *     and anybody on the internet marking deposits as paid.
 *
 *  2. THE RAW BODY. Read as text before any parsing, because a signature is
 *     over the exact bytes sent. Re-serialising JSON changes key order and
 *     whitespace and breaks verification in ways that look like an attack.
 *
 *  3. ONCE. Providers retry, and a retry that captures a deposit twice is a
 *     client charged twice. The unique index on `IdempotencyKey` does the
 *     deduplication — an insert that fails IS the duplicate check, so two
 *     deliveries arriving together cannot both pass a check-then-write.
 *
 *  4. 200 ON ANYTHING WE CANNOT USE. An event for an object this platform does
 *     not know about is not an error — it is a provider account doing
 *     something else. Returning 500 makes it retry for days.
 */

const SCOPE = 'payments:webhook'

export type WebhookOutcome =
  | { status: 400; body: { error: string } }
  | { status: 500; body: { error: string } }
  | { status: 200; body: Record<string, unknown> }

export async function handlePaymentWebhook(
  rawBody: string,
  signature: string,
): Promise<WebhookOutcome> {
  let event
  try {
    event = await paymentsPort().parseWebhook(rawBody, signature)
  } catch {
    // Deliberately says nothing about why. A verification oracle tells an
    // attacker whether they are getting warmer.
    return { status: 400, body: { error: 'Signature verification failed' } }
  }

  const requestHash = createHash('sha256').update(rawBody).digest('hex')
  const claimed = await claim(event.id, requestHash)
  if (!claimed) return { status: 200, body: { received: true, duplicate: true } }

  let outcome: Record<string, unknown>
  try {
    outcome = await dispatch(event)
  } catch (error) {
    /*
     * Release the claim and ask for a retry.
     *
     * Marking it done would silently drop a payment event, and a payment event
     * dropped is money whose state this platform never learns. But so would
     * LEAVING the claim in place: the retry would hit the unique index, be
     * read as a redelivery, and be answered 200 — the work quietly never
     * happening while the provider is told everything is fine.
     */
    await unsafeDb.idempotencyKey.updateMany({
      where: { scope: SCOPE, key: event.id },
      data: { status: 'FAILED', responseJson: { error: String(error) } as never },
    })
    return { status: 500, body: { error: 'Could not process' } }
  }

  await unsafeDb.idempotencyKey.updateMany({
    where: { scope: SCOPE, key: event.id },
    data: { status: 'DONE', responseJson: outcome as never },
  })

  return { status: 200, body: { received: true, ...outcome } }
}

/**
 * Take exclusive ownership of an event, or decline it.
 *
 * `IdempotencyKey` has been in the schema and in the database since the
 * initial migration, is already registered as a cross-tenant global model, and
 * had zero callers — it is exactly this shape, so this uses it rather than
 * adding a second table that would need its own tenancy decision.
 *
 * The insert IS the mutual exclusion: two deliveries arriving together cannot
 * both pass a check-then-write, because one of them loses to the unique index.
 * What the loser does next depends on what it lost to:
 *
 *   DONE         already handled. Nothing to do.
 *   IN_PROGRESS  somebody is working on it right now, unless they died —
 *                so it is taken over once it is older than the stale window.
 *   FAILED       the previous attempt released it. Take it and try again.
 */
const STALE_AFTER_MS = 5 * 60_000

async function claim(eventId: string, requestHash: string): Promise<boolean> {
  try {
    await unsafeDb.idempotencyKey.create({
      data: {
        scope: SCOPE,
        key: eventId,
        requestHash,
        status: 'IN_PROGRESS',
        // Long enough to cover any provider's retry schedule, short enough
        // that the table does not grow forever.
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    })
    return true
  } catch {
    // Lost the race, or this is a redelivery.
  }

  const existing = await unsafeDb.idempotencyKey.findUnique({
    where: { scope_key: { scope: SCOPE, key: eventId } },
    select: { id: true, status: true, createdAt: true },
  })
  if (!existing || existing.status === 'DONE') return false
  if (existing.status === 'IN_PROGRESS' && Date.now() - existing.createdAt.getTime() < STALE_AFTER_MS) {
    return false
  }

  /*
   * Take it over, conditionally on the status not having moved underneath us —
   * `updateMany` with the status in the WHERE is what makes this a compare and
   * swap rather than a read followed by a hopeful write.
   */
  const taken = await unsafeDb.idempotencyKey.updateMany({
    where: { id: existing.id, status: existing.status },
    data: { status: 'IN_PROGRESS', requestHash, createdAt: new Date() },
  })
  return taken.count === 1
}

async function dispatch(event: {
  id: string
  type: string
  objectId: string
  amountCents?: number
  metadata?: Record<string, string>
  customerRef?: string | null
  paymentMethodRef?: string | null
  failureCode?: string | null
  failureMessage?: string | null
}): Promise<Record<string, unknown>> {
  /*
   * A card finished being collected. The browser may already have told us, but
   * a browser that was closed mid-flow did not — and a client who added a card
   * and then lost their connection should still have one.
   */
  if (event.type.startsWith('setup_intent.')) {
    const salonId = event.metadata?.salonId
    const clientProfileId = event.metadata?.clientProfileId
    if (!salonId || !clientProfileId) return { handled: false, reason: 'no client on the event' }

    const { cards } = await syncCards({ salonId, clientProfileId })
    return { handled: true, kind: 'setup', cards: cards.length }
  }

  if (event.type.startsWith('payment_intent.')) {
    const deposit = await reconcileDepositEvent(event)
    if (deposit.matched) {
      return { handled: true, kind: 'deposit', status: deposit.status }
    }

    // Not a deposit — a payment taken at the till, which the provider confirms
    // the same way.
    const payment = await unsafeDb.payment.findFirst({
      where: { providerRef: event.objectId },
      select: { id: true, status: true },
    })
    if (!payment) return { handled: false, reason: 'nothing on file for that intent' }

    const status =
      event.type === 'payment_intent.succeeded'
        ? 'SUCCEEDED'
        : event.type === 'payment_intent.payment_failed'
          ? 'FAILED'
          : null
    if (!status || payment.status === status) {
      return { handled: true, kind: 'payment', status: payment.status }
    }

    await unsafeDb.payment.update({
      where: { id: payment.id },
      data: { status: status as never, failureCode: event.failureCode ?? null },
    })
    return { handled: true, kind: 'payment', status }
  }

  return { handled: false, reason: `nothing listens for ${event.type}` }
}
