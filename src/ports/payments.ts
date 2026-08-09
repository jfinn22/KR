import { createHmac, timingSafeEqual } from 'node:crypto'
import { AdapterError, mockId, mockNow, requireEnv } from './types'

/**
 * Payments.
 *
 * Deposits use an authorize-then-capture flow because a deposit taken six weeks
 * before an appointment is a promise, not a sale. Every mutating call takes an
 * idempotency key — double-tap is the dominant cause of real-world duplicate
 * charges.
 */

export type IntentStatus =
  'REQUIRES_PAYMENT_METHOD' | 'REQUIRES_CAPTURE' | 'SUCCEEDED' | 'CANCELLED' | 'FAILED'

export interface PaymentIntent {
  id: string
  amountCents: number
  currency: string
  status: IntentStatus
  capturedCents: number
  clientSecret: string
  createdAt: string
}

export interface CreateIntentInput {
  amountCents: number
  currency: string
  idempotencyKey: string
  /** Deposits authorise now and capture later; balances capture immediately. */
  captureMethod: 'automatic' | 'manual'
  description?: string
  metadata?: Record<string, string>
  /** The stored customer to charge against, for a card already on file. */
  customerRef?: string
  paymentMethodRef?: string
  /**
   * Charge a card whose owner is not at the keyboard.
   *
   * A deposit taken six weeks before an appointment, or forfeited after a
   * no-show, happens with nobody there to complete a challenge — which is
   * exactly the case a provider needs told about in advance, because the
   * agreement to charge later was made when they WERE there.
   */
  offSession?: boolean
  /** Attempt the charge immediately rather than handing back a client secret. */
  confirm?: boolean
}

/**
 * Collecting a card without charging it.
 *
 * The whole point: the browser talks to the provider directly and this server
 * never sees a card number. What comes back is a reference — worthless to
 * anybody who steals it, and the only thing worth storing.
 */
export type SetupStatus = 'REQUIRES_PAYMENT_METHOD' | 'REQUIRES_ACTION' | 'SUCCEEDED' | 'CANCELLED'

export interface SetupIntent {
  id: string
  clientSecret: string
  status: SetupStatus
  customerRef: string
  /** Present once the card is attached. */
  paymentMethodRef?: string | null
}

export interface StoredCard {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

export interface CustomerRef {
  id: string
}

export interface RefundResult {
  id: string
  amountCents: number
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED'
}

export interface SubscriptionResult {
  id: string
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED'
  currentPeriodEnd: string
}

export interface WebhookEvent {
  id: string
  type: string
  objectId: string
  amountCents?: number
  metadata?: Record<string, string>
  /**
   * Fields the reconciler needs and the flattened shape used to discard.
   *
   * A `setup_intent.succeeded` carries the card it just attached and is
   * meaningless without it; a `payment_intent.payment_failed` carries why, and
   * "your card was declined" is a different message from "your bank wants you
   * to confirm". Optional because not every event has them.
   */
  customerRef?: string | null
  paymentMethodRef?: string | null
  failureCode?: string | null
  failureMessage?: string | null

  /**
   * Which subscription this is about, and how long it now runs for.
   *
   * Separate from `objectId` because they are only the same thing on
   * `customer.subscription.*`. On `invoice.payment_failed` — the event dunning
   * exists to react to — `objectId` is the INVOICE, and routing on it means no
   * membership ever matches and the dunning clock never starts.
   *
   * `periodEnd` likewise cannot come from `metadata`: that is the user-defined
   * dict, the provider puts the period on the object itself, and nothing here
   * ever wrote such a key. Reading it from metadata means the period never
   * advances, which quietly turns a monthly allowance into a once-ever one.
   */
  subscriptionRef?: string | null
  periodEnd?: string | null
}

export interface PaymentsPort {
  readonly name: string
  createIntent(input: CreateIntentInput): Promise<PaymentIntent>
  getIntent(id: string): Promise<PaymentIntent | null>
  capture(id: string, amountCents?: number): Promise<PaymentIntent>
  cancel(id: string): Promise<PaymentIntent>
  refund(intentId: string, amountCents: number, idempotencyKey: string): Promise<RefundResult>

  /**
   * A customer at the provider, so a card can outlive one transaction.
   *
   * `createSubscription` below has always taken a `customerRef` that nothing
   * produced. This is what produces it — memberships and platform billing
   * inherit it rather than inventing a second one.
   */
  createCustomer(input: {
    email?: string | null
    name?: string | null
    idempotencyKey: string
    metadata?: Record<string, string>
  }): Promise<CustomerRef>

  createSetupIntent(input: {
    customerRef: string
    idempotencyKey: string
    metadata?: Record<string, string>
  }): Promise<SetupIntent>
  getSetupIntent(id: string): Promise<SetupIntent | null>

  listPaymentMethods(customerRef: string): Promise<StoredCard[]>
  detachPaymentMethod(paymentMethodRef: string): Promise<void>

  createSubscription(input: {
    customerRef: string
    priceId: string
    trialDays?: number
    idempotencyKey: string
  }): Promise<SubscriptionResult>

  /**
   * Move a live subscription onto a different price.
   *
   * Not `cancel then create`: that ends the period the payer has already
   * bought and starts a fresh one, which is the double-charge every
   * subscription complaint is about. The provider prorates against the period
   * already running, so a salon upgrading on the 20th pays the difference for
   * eleven days rather than a second full month.
   */
  updateSubscription(input: {
    subscriptionRef: string
    priceId: string
    idempotencyKey: string
  }): Promise<SubscriptionResult>

  /**
   * A recurring price at the provider.
   *
   * `createSubscription` takes a `priceId` and, until this existed, nothing
   * produced one for a salon's own membership plans — so `stripePriceId` had
   * no writer, the provider branch never ran, and every membership sold was
   * local bookkeeping that charged nobody a second time.
   *
   * Prices are immutable at the provider, so changing what a plan costs mints
   * a new one rather than editing this.
   */
  createPrice(input: {
    amountCents: number
    currency: string
    interval: 'MONTH' | 'YEAR'
    productName: string
    idempotencyKey: string
  }): Promise<{ id: string }>

  /**
   * Stop charging for a subscription.
   *
   * `atPeriodEnd` matters more here than anywhere else in this port: somebody
   * who cancels on the 3rd has bought the rest of the month and is entitled to
   * it, and ending it the moment they click is taking money for a service
   * withdrawn.
   */
  cancelSubscription(input: {
    subscriptionRef: string
    atPeriodEnd: boolean
    idempotencyKey: string
  }): Promise<SubscriptionResult>

  /**
   * Stop collecting for a while, without ending the subscription.
   *
   * The distinction that makes pausing worth having: a client going away for
   * three months keeps their membership and their history, and is not charged
   * for months they cannot use. A pause that kept billing would be strictly
   * worse for them than cancelling, which is the version nobody should ship.
   */
  pauseSubscription(input: {
    subscriptionRef: string
    paused: boolean
    idempotencyKey: string
  }): Promise<SubscriptionResult>

  parseWebhook(payload: string, signature: string): Promise<WebhookEvent>

  /**
   * Mint a signature this adapter's own `parseWebhook` will accept.
   *
   * Present only on adapters that can — the mock. It exists so an integration
   * test can drive the real webhook ROUTE end to end rather than calling the
   * reconciler directly, which would leave the route's verification, its
   * replay guard and its error handling untested. A real provider signs with a
   * secret only it holds, so `StripePaymentsAdapter` does not implement it and
   * production code must never call it.
   */
  signTestPayload?(payload: string, atEpochSeconds?: number): string

  /**
   * Finish a card setup without a browser.
   *
   * Present only on the mock, for the same reason as above and one more: with
   * no provider account configured there is no Elements to render, and a card
   * step that simply cannot be completed makes the whole booking journey
   * untestable in dev and CI. The card form falls back to this.
   *
   * `StripePaymentsAdapter` does not implement it, so the fallback is
   * structurally unreachable the moment a real key is configured — it is not
   * guarded by a flag somebody can set wrong.
   */
  attachTestCard?(setupIntentId: string, card?: Partial<StoredCard>): StoredCard
}

/**
 * The mock's signing scheme: `t=<epoch>,v1=<hmac of t.payload>`.
 *
 * Deliberately the same shape a real provider uses, so the route that verifies
 * it is exercising the same code path in both modes — a mock that is trivially
 * verifiable teaches the route nothing. The secret is a constant because this
 * adapter only ever runs where there is nothing to protect.
 */
const MOCK_WEBHOOK_SECRET = 'mock-webhook-secret'
const MOCK_TOLERANCE_SECONDS = 300

function signMockPayload(payload: string, atEpochSeconds?: number): string {
  const t = atEpochSeconds ?? Math.floor(Date.parse(mockNow()) / 1000)
  const v1 = createHmac('sha256', MOCK_WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex')
  return `t=${t},v1=${v1}`
}

function verifyMockSignature(payload: string, signature: string): boolean {
  const parts = Object.fromEntries(
    signature.split(',').map((part) => {
      const at = part.indexOf('=')
      return [part.slice(0, at), part.slice(at + 1)]
    }),
  )
  const t = Number(parts.t)
  if (!Number.isFinite(t) || typeof parts.v1 !== 'string') return false

  // A signature is only good for a window. Without this, anybody who captured
  // one valid delivery could replay it forever.
  const age = Math.abs(Math.floor(Date.now() / 1000) - t)
  if (age > MOCK_TOLERANCE_SECONDS) return false

  const expected = createHmac('sha256', MOCK_WEBHOOK_SECRET)
    .update(`${t}.${payload}`)
    .digest('hex')
  const given = Buffer.from(parts.v1, 'utf8')
  const want = Buffer.from(expected, 'utf8')
  // Constant time, so a wrong signature does not leak how wrong it was.
  return given.length === want.length && timingSafeEqual(given, want)
}

export function assertAmount(port: string, amountCents: number): void {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new AdapterError(
      port,
      'INVALID_AMOUNT',
      `Amount must be a positive integer number of cents, got ${amountCents}.`,
    )
  }
}

// ---------------------------------------------------------------------------

export class MockPaymentsAdapter implements PaymentsPort {
  readonly name = 'payments:mock'

  private readonly intents = new Map<string, PaymentIntent>()
  private readonly byIdempotency = new Map<string, string>()
  private readonly refunds = new Map<string, RefundResult>()
  private readonly customers = new Map<string, CustomerRef>()
  private readonly setups = new Map<string, SetupIntent>()
  private readonly cards = new Map<string, StoredCard[]>()
  private readonly subscriptions = new Map<string, SubscriptionResult>()

  async createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    assertAmount(this.name, input.amountCents)

    // Replaying the same key returns the original intent rather than charging twice.
    const existing = this.byIdempotency.get(input.idempotencyKey)
    if (existing) return { ...this.intents.get(existing)! }

    /*
     * A card on file that is confirmed off-session lands already authorised —
     * there is nobody at the keyboard to complete a step, which is the whole
     * reason the agreement was taken in advance.
     *
     * Automatic capture without confirm is NOT succeeded: that is an incomplete
     * PaymentIntent waiting on the browser (or a terminal). Treating it as paid
     * is how the till used to settle a bill against a charge that never ran.
     */
    const chargedNow = Boolean(input.confirm && input.paymentMethodRef)
    const id = mockId('pi', input.idempotencyKey)
    const status: PaymentIntent['status'] = chargedNow
      ? input.captureMethod === 'manual'
        ? 'REQUIRES_CAPTURE'
        : 'SUCCEEDED'
      : 'REQUIRES_PAYMENT_METHOD'
    const intent: PaymentIntent = {
      id,
      amountCents: input.amountCents,
      currency: input.currency,
      status,
      capturedCents: status === 'SUCCEEDED' ? input.amountCents : 0,
      clientSecret: `${id}_secret`,
      createdAt: mockNow(),
    }
    this.intents.set(id, intent)
    this.byIdempotency.set(input.idempotencyKey, id)
    return { ...intent }
  }

  /** Dev/CI stand-in for the browser confirming a PaymentIntent. */
  confirmTestIntent(id: string): PaymentIntent {
    const intent = this.intents.get(id)
    if (!intent) throw new AdapterError(this.name, 'NOT_FOUND', 'No such payment intent.')
    const updated: PaymentIntent = {
      ...intent,
      status: 'SUCCEEDED',
      capturedCents: intent.amountCents,
    }
    this.intents.set(id, updated)
    return { ...updated }
  }

  async createCustomer(input: {
    email?: string | null
    name?: string | null
    idempotencyKey: string
  }): Promise<CustomerRef> {
    const id = mockId('cus', input.idempotencyKey)
    const existing = this.customers.get(id)
    if (existing) return { ...existing }
    const created = { id }
    this.customers.set(id, created)
    this.cards.set(id, [])
    return { ...created }
  }

  async createSetupIntent(input: {
    customerRef: string
    idempotencyKey: string
  }): Promise<SetupIntent> {
    const id = mockId('seti', input.idempotencyKey)
    const existing = this.setups.get(id)
    if (existing) return { ...existing }

    const setup: SetupIntent = {
      id,
      clientSecret: `${id}_secret`,
      status: 'REQUIRES_PAYMENT_METHOD',
      customerRef: input.customerRef,
      paymentMethodRef: null,
    }
    this.setups.set(id, setup)
    return { ...setup }
  }

  async getSetupIntent(id: string): Promise<SetupIntent | null> {
    const found = this.setups.get(id)
    return found ? { ...found } : null
  }

  async listPaymentMethods(customerRef: string): Promise<StoredCard[]> {
    return (this.cards.get(customerRef) ?? []).map((card) => ({ ...card }))
  }

  async detachPaymentMethod(paymentMethodRef: string): Promise<void> {
    for (const [customer, list] of this.cards) {
      this.cards.set(
        customer,
        list.filter((card) => card.id !== paymentMethodRef),
      )
    }
  }

  /**
   * Test helper: pretend the client finished the card form.
   *
   * The real flow completes in the browser and comes back as a webhook. This
   * is the same landing place, reached without one — so a test can set up "a
   * client with a card on file" in one line instead of six.
   */
  attachTestCard(setupIntentId: string, card?: Partial<StoredCard>): StoredCard {
    const setup = this.setups.get(setupIntentId)
    if (!setup) throw new AdapterError(this.name, 'NOT_FOUND', `No setup intent ${setupIntentId}.`)

    const stored: StoredCard = {
      id: mockId('pm', setupIntentId),
      brand: card?.brand ?? 'visa',
      last4: card?.last4 ?? '4242',
      expMonth: card?.expMonth ?? 12,
      expYear: card?.expYear ?? 2030,
    }
    this.cards.set(setup.customerRef, [...(this.cards.get(setup.customerRef) ?? []), stored])
    this.setups.set(setupIntentId, {
      ...setup,
      status: 'SUCCEEDED',
      paymentMethodRef: stored.id,
    })
    return stored
  }

  async getIntent(id: string): Promise<PaymentIntent | null> {
    const found = this.intents.get(id)
    return found ? { ...found } : null
  }

  async capture(id: string, amountCents?: number): Promise<PaymentIntent> {
    const intent = this.intents.get(id)
    if (!intent) throw new AdapterError(this.name, 'NOT_FOUND', `No intent ${id}.`)
    if (intent.status === 'SUCCEEDED') return { ...intent }
    if (intent.status !== 'REQUIRES_CAPTURE') {
      throw new AdapterError(
        this.name,
        'INVALID_STATE',
        `Cannot capture an intent that is ${intent.status}.`,
      )
    }
    const amount = amountCents ?? intent.amountCents
    if (amount > intent.amountCents) {
      throw new AdapterError(this.name, 'OVER_CAPTURE', 'Cannot capture more than was authorised.')
    }
    const updated: PaymentIntent = { ...intent, status: 'SUCCEEDED', capturedCents: amount }
    this.intents.set(id, updated)
    return { ...updated }
  }

  async cancel(id: string): Promise<PaymentIntent> {
    const intent = this.intents.get(id)
    if (!intent) throw new AdapterError(this.name, 'NOT_FOUND', `No intent ${id}.`)
    if (intent.status === 'SUCCEEDED') {
      throw new AdapterError(
        this.name,
        'INVALID_STATE',
        'Cannot cancel a captured intent; refund it.',
      )
    }
    const updated: PaymentIntent = { ...intent, status: 'CANCELLED' }
    this.intents.set(id, updated)
    return { ...updated }
  }

  async refund(
    intentId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<RefundResult> {
    assertAmount(this.name, amountCents)
    const existing = this.refunds.get(idempotencyKey)
    if (existing) return { ...existing }

    const intent = this.intents.get(intentId)
    if (!intent) throw new AdapterError(this.name, 'NOT_FOUND', `No intent ${intentId}.`)
    if (intent.status !== 'SUCCEEDED') {
      throw new AdapterError(this.name, 'INVALID_STATE', 'Only a captured payment can be refunded.')
    }
    if (amountCents > intent.capturedCents) {
      throw new AdapterError(this.name, 'OVER_REFUND', 'Refund exceeds the captured amount.')
    }

    const result: RefundResult = {
      id: mockId('re', idempotencyKey),
      amountCents,
      status: 'SUCCEEDED',
    }
    this.refunds.set(idempotencyKey, result)
    this.intents.set(intentId, { ...intent, capturedCents: intent.capturedCents - amountCents })
    return { ...result }
  }

  async createSubscription(input: {
    customerRef: string
    priceId: string
    trialDays?: number
    idempotencyKey: string
  }): Promise<SubscriptionResult> {
    const end = new Date(mockNow())
    end.setDate(end.getDate() + (input.trialDays ?? 30))
    const result: SubscriptionResult = {
      id: mockId('sub', input.idempotencyKey),
      status: input.trialDays ? 'TRIALING' : 'ACTIVE',
      currentPeriodEnd: end.toISOString(),
    }
    this.subscriptions.set(result.id, result)
    return { ...result }
  }

  /**
   * Kept rather than recomputed, because the period end is the whole point.
   *
   * A mock that returned `now + 30 days` here would pass a test asserting the
   * upgrade worked while hiding the bug that upgrade is most likely to have —
   * a restarted period, billed again from scratch.
   */
  async updateSubscription(input: {
    subscriptionRef: string
    priceId: string
    idempotencyKey: string
  }): Promise<SubscriptionResult> {
    const existing = this.subscriptions.get(input.subscriptionRef)
    if (!existing) {
      throw new AdapterError('payments', 'NOT_FOUND', 'No such subscription.')
    }
    const result: SubscriptionResult = { ...existing, status: 'ACTIVE' }
    this.subscriptions.set(result.id, result)
    return { ...result }
  }

  async createPrice(input: {
    amountCents: number
    currency: string
    interval: 'MONTH' | 'YEAR'
    productName: string
    idempotencyKey: string
  }): Promise<{ id: string }> {
    return { id: mockId('price', input.idempotencyKey) }
  }

  async pauseSubscription(input: {
    subscriptionRef: string
    paused: boolean
    idempotencyKey: string
  }): Promise<SubscriptionResult> {
    const existing = this.subscriptions.get(input.subscriptionRef)
    if (!existing) {
      throw new AdapterError('payments', 'NOT_FOUND', 'No such subscription.')
    }
    // The period is untouched either way: a pause is not a renewal, and the
    // client keeps whatever they had already paid for when they come back.
    this.subscriptions.set(existing.id, existing)
    return { ...existing }
  }

  async cancelSubscription(input: {
    subscriptionRef: string
    atPeriodEnd: boolean
    idempotencyKey: string
  }): Promise<SubscriptionResult> {
    const existing = this.subscriptions.get(input.subscriptionRef)
    if (!existing) {
      throw new AdapterError('payments', 'NOT_FOUND', 'No such subscription.')
    }
    /*
     * Cancelling at the period end leaves the subscription ACTIVE — that is
     * the point of it, and a mock that reported CANCELLED straight away would
     * let a test pass while the client lost the weeks they had paid for.
     */
    const result: SubscriptionResult = {
      ...existing,
      status: input.atPeriodEnd ? existing.status : 'CANCELLED',
    }
    this.subscriptions.set(result.id, result)
    return { ...result }
  }

  /**
   * In mock mode a "webhook" is JSON we synthesised — but signed properly.
   *
   * This used to compare against the constant string `mock-signature`, which
   * meant the one property a webhook endpoint most needs — that an old
   * payload replayed by somebody who captured it is refused — could not be
   * tested at all, because every signature was valid forever. The scheme here
   * is the timestamped HMAC the platform already uses for its OUTBOUND
   * webhooks, with the same tolerance, so there is one idea rather than two.
   */
  async parseWebhook(payload: string, signature: string): Promise<WebhookEvent> {
    if (!verifyMockSignature(payload, signature)) {
      throw new AdapterError(this.name, 'BAD_SIGNATURE', 'Webhook signature did not verify.')
    }
    const parsed = JSON.parse(payload) as WebhookEvent
    if (!parsed.id || !parsed.type || !parsed.objectId) {
      throw new AdapterError(
        this.name,
        'MALFORMED',
        'Webhook payload missing id, type or objectId.',
      )
    }
    return parsed
  }

  signTestPayload(payload: string, atEpochSeconds?: number): string {
    return signMockPayload(payload, atEpochSeconds)
  }

  /** Test helper: build a payload `parseWebhook` will accept. */
  static synthesizeWebhook(
    event: WebhookEvent,
    atEpochSeconds?: number,
  ): { payload: string; signature: string } {
    const payload = JSON.stringify(event)
    return { payload, signature: signMockPayload(payload, atEpochSeconds) }
  }
}

const STRIPE_SUBSCRIPTION_STATUS: Record<string, SubscriptionResult['status']> = {
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  canceled: 'CANCELLED',
}

/**
 * One reading of a Stripe subscription, so create and update cannot drift.
 *
 * `current_period_end` is read through a cast because it moved off the
 * top-level subscription in a later API version than the types installed here
 * describe; an absent value becomes epoch rather than `Invalid Date`, which is
 * at least a value the caller can notice.
 */
function toSubscriptionResult(sub: { id: string; status: string }): SubscriptionResult {
  return {
    id: sub.id,
    status: STRIPE_SUBSCRIPTION_STATUS[sub.status] ?? 'CANCELLED',
    currentPeriodEnd: new Date(
      ((sub as unknown as { current_period_end?: number }).current_period_end ?? 0) * 1000,
    ).toISOString(),
  }
}

export class StripePaymentsAdapter implements PaymentsPort {
  readonly name = 'payments:stripe'

  constructor(
    private readonly secretKey?: string,
    private readonly webhookSecret?: string,
  ) {}

  private async client() {
    requireEnv('payments', { STRIPE_SECRET_KEY: this.secretKey })
    const { default: Stripe } = await import('stripe')
    return new Stripe(this.secretKey!, { apiVersion: '2024-12-18.acacia' as never })
  }

  private static toIntent(pi: {
    id: string
    amount: number
    currency: string
    status: string
    amount_received?: number
    client_secret?: string | null
    created: number
  }): PaymentIntent {
    const statusMap: Record<string, IntentStatus> = {
      requires_payment_method: 'REQUIRES_PAYMENT_METHOD',
      requires_capture: 'REQUIRES_CAPTURE',
      succeeded: 'SUCCEEDED',
      canceled: 'CANCELLED',
    }
    return {
      id: pi.id,
      amountCents: pi.amount,
      currency: pi.currency,
      status: statusMap[pi.status] ?? 'FAILED',
      capturedCents: pi.amount_received ?? 0,
      clientSecret: pi.client_secret ?? '',
      createdAt: new Date(pi.created * 1000).toISOString(),
    }
  }

  async createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    assertAmount(this.name, input.amountCents)
    const stripe = await this.client()
    const pi = await stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency,
        capture_method: input.captureMethod,
        description: input.description,
        metadata: input.metadata,
        customer: input.customerRef,
        payment_method: input.paymentMethodRef,
        // Told in advance, because the agreement to charge later was made when
        // the client WAS at the keyboard and the provider needs to know that.
        off_session: input.offSession,
        confirm: input.confirm,
      },
      { idempotencyKey: input.idempotencyKey },
    )
    return StripePaymentsAdapter.toIntent(pi as never)
  }

  async createCustomer(input: {
    email?: string | null
    name?: string | null
    idempotencyKey: string
    metadata?: Record<string, string>
  }): Promise<CustomerRef> {
    const stripe = await this.client()
    const customer = await stripe.customers.create(
      {
        email: input.email ?? undefined,
        name: input.name ?? undefined,
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    )
    return { id: customer.id }
  }

  async createSetupIntent(input: {
    customerRef: string
    idempotencyKey: string
    metadata?: Record<string, string>
  }): Promise<SetupIntent> {
    const stripe = await this.client()
    const si = await stripe.setupIntents.create(
      {
        customer: input.customerRef,
        // The card is being stored so it can be charged when nobody is there.
        usage: 'off_session',
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    )
    return StripePaymentsAdapter.toSetup(si as never, input.customerRef)
  }

  async getSetupIntent(id: string): Promise<SetupIntent | null> {
    const stripe = await this.client()
    try {
      const si = await stripe.setupIntents.retrieve(id)
      return StripePaymentsAdapter.toSetup(si as never, String(si.customer ?? ''))
    } catch {
      return null
    }
  }

  async listPaymentMethods(customerRef: string): Promise<StoredCard[]> {
    const stripe = await this.client()
    const list = await stripe.paymentMethods.list({ customer: customerRef, type: 'card' })
    return list.data.flatMap((pm) =>
      pm.card
        ? [
            {
              id: pm.id,
              brand: pm.card.brand,
              last4: pm.card.last4,
              expMonth: pm.card.exp_month,
              expYear: pm.card.exp_year,
            },
          ]
        : [],
    )
  }

  async detachPaymentMethod(paymentMethodRef: string): Promise<void> {
    const stripe = await this.client()
    await stripe.paymentMethods.detach(paymentMethodRef)
  }

  private static toSetup(
    si: { id: string; client_secret?: string | null; status: string; payment_method?: unknown },
    customerRef: string,
  ): SetupIntent {
    const statusMap: Record<string, SetupStatus> = {
      requires_payment_method: 'REQUIRES_PAYMENT_METHOD',
      requires_action: 'REQUIRES_ACTION',
      requires_confirmation: 'REQUIRES_ACTION',
      succeeded: 'SUCCEEDED',
      canceled: 'CANCELLED',
    }
    const pm = si.payment_method
    return {
      id: si.id,
      clientSecret: si.client_secret ?? '',
      status: statusMap[si.status] ?? 'REQUIRES_PAYMENT_METHOD',
      customerRef,
      paymentMethodRef: typeof pm === 'string' ? pm : ((pm as { id?: string })?.id ?? null),
    }
  }

  async getIntent(id: string): Promise<PaymentIntent | null> {
    const stripe = await this.client()
    try {
      return StripePaymentsAdapter.toIntent((await stripe.paymentIntents.retrieve(id)) as never)
    } catch {
      return null
    }
  }

  async capture(id: string, amountCents?: number): Promise<PaymentIntent> {
    const stripe = await this.client()
    const pi = await stripe.paymentIntents.capture(
      id,
      amountCents ? { amount_to_capture: amountCents } : undefined,
    )
    return StripePaymentsAdapter.toIntent(pi as never)
  }

  async cancel(id: string): Promise<PaymentIntent> {
    const stripe = await this.client()
    return StripePaymentsAdapter.toIntent((await stripe.paymentIntents.cancel(id)) as never)
  }

  async refund(
    intentId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<RefundResult> {
    assertAmount(this.name, amountCents)
    const stripe = await this.client()
    const refund = await stripe.refunds.create(
      { payment_intent: intentId, amount: amountCents },
      { idempotencyKey },
    )
    return {
      id: refund.id,
      amountCents: refund.amount,
      status: refund.status === 'succeeded' ? 'SUCCEEDED' : 'PENDING',
    }
  }

  async createSubscription(input: {
    customerRef: string
    priceId: string
    trialDays?: number
    idempotencyKey: string
  }): Promise<SubscriptionResult> {
    const stripe = await this.client()
    const sub = await stripe.subscriptions.create(
      {
        customer: input.customerRef,
        items: [{ price: input.priceId }],
        trial_period_days: input.trialDays,
      },
      { idempotencyKey: input.idempotencyKey },
    )
    return toSubscriptionResult(sub)
  }

  async updateSubscription(input: {
    subscriptionRef: string
    priceId: string
    idempotencyKey: string
  }): Promise<SubscriptionResult> {
    const stripe = await this.client()
    const current = await stripe.subscriptions.retrieve(input.subscriptionRef)
    const item = current.items.data[0]
    if (!item) {
      throw new AdapterError('payments', 'INVALID', 'That subscription has nothing on it to move.')
    }

    const sub = await stripe.subscriptions.update(
      input.subscriptionRef,
      {
        items: [{ id: item.id, price: input.priceId }],
        /*
         * The provider works out what is owed for the rest of the period the
         * salon has already paid for. Left to default it would create the
         * proration lines but not bill them until the next cycle, which reads
         * to a salon as a free upgrade followed by a surprise.
         */
        proration_behavior: 'always_invoice',
      },
      { idempotencyKey: input.idempotencyKey },
    )
    return toSubscriptionResult(sub)
  }

  async createPrice(input: {
    amountCents: number
    currency: string
    interval: 'MONTH' | 'YEAR'
    productName: string
    idempotencyKey: string
  }): Promise<{ id: string }> {
    const stripe = await this.client()
    const price = await stripe.prices.create(
      {
        unit_amount: input.amountCents,
        currency: input.currency.toLowerCase(),
        recurring: { interval: input.interval === 'YEAR' ? 'year' : 'month' },
        product_data: { name: input.productName },
      },
      { idempotencyKey: input.idempotencyKey },
    )
    return { id: price.id }
  }

  async pauseSubscription(input: {
    subscriptionRef: string
    paused: boolean
    idempotencyKey: string
  }): Promise<SubscriptionResult> {
    const stripe = await this.client()
    const sub = await stripe.subscriptions.update(
      input.subscriptionRef,
      {
        /*
         * `void` rather than `keep_as_draft`: invoices raised while paused are
         * discarded outright. Keeping them as drafts would present the client
         * with a bill for the months they were away the moment they came back,
         * which is the pause failing at exactly the point it mattered.
         */
        pause_collection: input.paused ? { behavior: 'void' } : null,
      },
      { idempotencyKey: input.idempotencyKey },
    )
    return toSubscriptionResult(sub)
  }

  async cancelSubscription(input: {
    subscriptionRef: string
    atPeriodEnd: boolean
    idempotencyKey: string
  }): Promise<SubscriptionResult> {
    const stripe = await this.client()
    const sub = input.atPeriodEnd
      ? await stripe.subscriptions.update(
          input.subscriptionRef,
          { cancel_at_period_end: true },
          { idempotencyKey: input.idempotencyKey },
        )
      : await stripe.subscriptions.cancel(input.subscriptionRef, {
          // No proration credit: ending it early is the salon's choice, and
          // whatever is owed back is a refund somebody decides on, not one the
          // provider issues silently.
          prorate: false,
        })
    return toSubscriptionResult(sub)
  }

  async parseWebhook(payload: string, signature: string): Promise<WebhookEvent> {
    requireEnv('payments', { STRIPE_WEBHOOK_SECRET: this.webhookSecret })
    const stripe = await this.client()
    let event
    try {
      event = stripe.webhooks.constructEvent(payload, signature, this.webhookSecret!)
    } catch (err) {
      throw new AdapterError(this.name, 'BAD_SIGNATURE', (err as Error).message)
    }
    const object = event.data.object as {
      id: string
      object?: string
      amount?: number
      metadata?: Record<string, string>
      customer?: string | { id: string } | null
      payment_method?: string | { id: string } | null
      last_payment_error?: { code?: string; message?: string } | null
      subscription?: string | { id: string } | null
      current_period_end?: number | null
      lines?: { data?: { period?: { end?: number | null } | null }[] } | null
    }
    const ref = (value: string | { id: string } | null | undefined) =>
      typeof value === 'string' ? value : (value?.id ?? null)

    /*
     * On a subscription event the object IS the subscription; on an invoice it
     * carries one. Anything else has neither, and gets null rather than an id
     * of the wrong kind — a wrong id matches nothing, which looks the same as
     * "not ours" and is how this went unnoticed.
     */
    const subscriptionRef =
      object.object === 'subscription' ? object.id : ref(object.subscription)

    /*
     * A subscription states its own period end. An invoice does not — its
     * lines carry the period they billed for, and the first line's end is the
     * date the subscription now runs to.
     */
    const periodEndSeconds =
      object.current_period_end ?? object.lines?.data?.[0]?.period?.end ?? null

    return {
      id: event.id,
      type: event.type,
      objectId: object.id,
      amountCents: object.amount,
      metadata: object.metadata,
      // Carried rather than discarded: a setup_intent.succeeded is meaningless
      // without the card it just attached, and a failure without its reason
      // cannot be turned into anything a client can act on.
      customerRef: ref(object.customer),
      paymentMethodRef: ref(object.payment_method),
      failureCode: object.last_payment_error?.code ?? null,
      failureMessage: object.last_payment_error?.message ?? null,
      subscriptionRef,
      periodEnd: periodEndSeconds ? new Date(periodEndSeconds * 1000).toISOString() : null,
    }
  }
}
