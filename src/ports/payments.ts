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
}

export interface PaymentsPort {
  readonly name: string
  createIntent(input: CreateIntentInput): Promise<PaymentIntent>
  getIntent(id: string): Promise<PaymentIntent | null>
  capture(id: string, amountCents?: number): Promise<PaymentIntent>
  cancel(id: string): Promise<PaymentIntent>
  refund(intentId: string, amountCents: number, idempotencyKey: string): Promise<RefundResult>
  createSubscription(input: {
    customerRef: string
    priceId: string
    trialDays?: number
    idempotencyKey: string
  }): Promise<SubscriptionResult>
  parseWebhook(payload: string, signature: string): Promise<WebhookEvent>
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

  async createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    assertAmount(this.name, input.amountCents)

    // Replaying the same key returns the original intent rather than charging twice.
    const existing = this.byIdempotency.get(input.idempotencyKey)
    if (existing) return { ...this.intents.get(existing)! }

    const id = mockId('pi', input.idempotencyKey)
    const intent: PaymentIntent = {
      id,
      amountCents: input.amountCents,
      currency: input.currency,
      status: input.captureMethod === 'manual' ? 'REQUIRES_CAPTURE' : 'SUCCEEDED',
      capturedCents: input.captureMethod === 'manual' ? 0 : input.amountCents,
      clientSecret: `${id}_secret`,
      createdAt: mockNow(),
    }
    this.intents.set(id, intent)
    this.byIdempotency.set(input.idempotencyKey, id)
    return { ...intent }
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
    return {
      id: mockId('sub', input.idempotencyKey),
      status: input.trialDays ? 'TRIALING' : 'ACTIVE',
      currentPeriodEnd: end.toISOString(),
    }
  }

  /** In mock mode a "webhook" is just JSON we synthesised ourselves. */
  async parseWebhook(payload: string, signature: string): Promise<WebhookEvent> {
    if (signature !== 'mock-signature') {
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

  /** Test helper: build a payload `parseWebhook` will accept. */
  static synthesizeWebhook(event: WebhookEvent): { payload: string; signature: string } {
    return { payload: JSON.stringify(event), signature: 'mock-signature' }
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
      },
      { idempotencyKey: input.idempotencyKey },
    )
    return StripePaymentsAdapter.toIntent(pi as never)
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
    const statusMap: Record<string, SubscriptionResult['status']> = {
      trialing: 'TRIALING',
      active: 'ACTIVE',
      past_due: 'PAST_DUE',
      canceled: 'CANCELLED',
    }
    return {
      id: sub.id,
      status: statusMap[sub.status] ?? 'CANCELLED',
      currentPeriodEnd: new Date(
        ((sub as unknown as { current_period_end: number }).current_period_end ?? 0) * 1000,
      ).toISOString(),
    }
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
      amount?: number
      metadata?: Record<string, string>
    }
    return {
      id: event.id,
      type: event.type,
      objectId: object.id,
      amountCents: object.amount,
      metadata: object.metadata,
    }
  }
}
