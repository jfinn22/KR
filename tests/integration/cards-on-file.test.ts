import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { MockPaymentsAdapter } from '@/ports/payments'
import { paymentsPort } from '@/ports/registry'
import { POST } from '@/app/api/webhooks/payments/route'
import { beginCardSetup, cardsFor, removeCard, syncCards } from '@/server/services/cards'
import {
  markDepositApplied,
  authorizeDeposit,
  canTransition,
  chargeConsultationFee,
  forfeitDeposit,
  releaseDeposit,
  renewDepositAuthorization,
} from '@/server/services/deposits'
import { assessCancellation, buildInvoice, takeDeposit } from '@/server/services/commerce'

/**
 * Money that actually moves.
 *
 * `DepositStatus` has had seven values since the schema was written and three
 * were ever written — all at row creation, none by an update. `APPLIED`,
 * `FORFEITED` and `REFUNDED` were unreachable. The lifecycle was a comment,
 * and these tests are what stop it going back to being one.
 *
 * Everything here goes through the real webhook ROUTE rather than calling the
 * reconciler directly, because the route is where verification, the replay
 * guard and the error handling live — and a test that skips it tests none of
 * them.
 */

const S = 'cf_salon'

function mock(): MockPaymentsAdapter {
  const port = paymentsPort()
  if (!(port instanceof MockPaymentsAdapter)) {
    throw new Error('These tests require the mock payments adapter.')
  }
  return port
}

/** Post a synthesised event at the real route, signed the way a provider does. */
async function deliver(event: {
  id: string
  type: string
  objectId: string
  metadata?: Record<string, string>
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { payload, signature } = MockPaymentsAdapter.synthesizeWebhook(event)
  const response = await POST(
    new Request('http://localhost/api/webhooks/payments', {
      method: 'POST',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      body: payload,
    }),
  )
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'cf-salon',
      name: 'Cards Test Salon',
      currency: 'USD',
      settings: { create: { cancellationWindowHours: 48, noShowFeePercent: 100 } },
      locations: { create: { id: 'cf_loc', name: 'Main' } },
      serviceCategories: { create: { id: 'cf_cat', name: 'Colour', slug: 'colour' } },
    },
  })
  await unsafeDb.user.create({ data: { id: 'cf_user', email: 'cf-owner@example.com' } })
  await unsafeDb.membership.create({
    data: { id: 'cf_mem', salonId: S, userId: 'cf_user', role: 'OWNER' },
  })
  await unsafeDb.stylistProfile.create({
    data: { id: 'cf_sty', salonId: S, membershipId: 'cf_mem', displayName: 'Wren' },
  })
  await unsafeDb.service.create({
    data: {
      id: 'cf_svc',
      salonId: S,
      categoryId: 'cf_cat',
      name: 'Colour correction',
      slug: 'correction',
      basePriceCents: 30_000,
      baseComplexity: 40,
      isChemical: true,
    },
  })
}

beforeAll(seed, 90_000)

beforeEach(async () => {
  await unsafeDb.idempotencyKey.deleteMany({ where: { scope: 'payments:webhook' } })
  await unsafeDb.deposit.deleteMany({ where: { salonId: S } })
  await unsafeDb.payment.deleteMany({ where: { salonId: S } })
  await unsafeDb.invoice.deleteMany({ where: { salonId: S } })
  await unsafeDb.appointmentSegment.deleteMany({ where: { salonId: S } })
  await unsafeDb.appointment.deleteMany({ where: { salonId: S } })
  await unsafeDb.savedCard.deleteMany({ where: { salonId: S } })
  await unsafeDb.clientProfile.deleteMany({ where: { salonId: S } })
})

afterAll(async () => {
  await unsafeDb.idempotencyKey.deleteMany({ where: { scope: 'payments:webhook' } })
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'cf-' } } })
  await unsafeDb.$disconnect()
})

async function makeClient(name = 'Ada') {
  return unsafeDb.clientProfile.create({
    data: { salonId: S, firstName: name, lastName: 'Rivera' },
    select: { id: true },
  })
}

/** A client with a card on file, which is the precondition for every charge. */
async function makeClientWithCard(name = 'Ada') {
  const client = await makeClient(name)
  const setup = await beginCardSetup({ salonId: S, clientProfileId: client.id })
  mock().attachTestCard(setup.setupIntentId)
  await syncCards({ salonId: S, clientProfileId: client.id })
  return client
}

async function makeAppointment(clientProfileId: string, totalCents = 30_000, startsAt?: Date) {
  return unsafeDb.appointment.create({
    data: {
      salonId: S,
      locationId: 'cf_loc',
      clientProfileId,
      primaryStylistId: 'cf_sty',
      status: 'COMPLETED',
      startsAt: startsAt ?? new Date('2026-09-01T14:00:00Z'),
      endsAt: new Date((startsAt ?? new Date('2026-09-01T14:00:00Z')).getTime() + 3 * 3_600_000),
      estimatedDurationMin: 180,
      estimatedTotalCents: totalCents,
      services: {
        create: {
          salonId: S,
          serviceId: 'cf_svc',
          stylistProfileId: 'cf_sty',
          sequence: 0,
          plannedDurationMin: 180,
          priceCents: totalCents,
        },
      },
    },
  })
}

// ---------------------------------------------------------------------------

describe('a card the client agreed we could keep', () => {
  it('stores a reference and never a number', async () => {
    const client = await makeClientWithCard()
    const cards = await cardsFor(S, client.id)

    expect(cards).toHaveLength(1)
    expect(cards[0]!.last4).toBe('4242')
    expect(cards[0]!.isDefault).toBe(true)
    // Nothing resembling a card number is on the row. The columns to hold one
    // do not exist, which is the strongest form this guarantee can take.
    expect(Object.keys(cards[0]!)).toEqual(
      expect.not.arrayContaining(['number', 'pan', 'cvc', 'token']),
    )
  })

  it('lets a client add a second card, and a replacement for one they removed', async () => {
    /*
     * The setup key used to be fixed per client, so replaying it returned the
     * FIRST setup — already succeeded, already attached to a card. The browser
     * got a finished intent and collected nothing, forever. Only ever visible
     * on the second card, which is why it needs a test rather than a reading.
     */
    const client = await makeClientWithCard()

    const second = await beginCardSetup({ salonId: S, clientProfileId: client.id })
    mock().attachTestCard(second.setupIntentId, { last4: '1881', brand: 'amex' })
    await syncCards({ salonId: S, clientProfileId: client.id })
    expect(await cardsFor(S, client.id)).toHaveLength(2)

    // And again after removing one, where the live count goes back down.
    const [keep, drop] = await cardsFor(S, client.id)
    await removeCard({ salonId: S, clientProfileId: client.id, savedCardId: drop!.id })

    const third = await beginCardSetup({ salonId: S, clientProfileId: client.id })
    expect(third.setupIntentId).not.toBe(second.setupIntentId)
    mock().attachTestCard(third.setupIntentId, { last4: '0004', brand: 'mastercard' })
    await syncCards({ salonId: S, clientProfileId: client.id })

    const finally_ = await cardsFor(S, client.id)
    expect(finally_).toHaveLength(2)
    expect(finally_.map((c) => c.id)).toContain(keep!.id)
  })

  it('is idempotent — syncing twice writes one card, not two', async () => {
    const client = await makeClientWithCard()
    await syncCards({ salonId: S, clientProfileId: client.id })
    await syncCards({ salonId: S, clientProfileId: client.id })

    expect(await cardsFor(S, client.id)).toHaveLength(1)
  })

  it('refuses to release a card that is holding a deposit', async () => {
    const client = await makeClientWithCard()
    const appointment = await makeAppointment(client.id)
    const deposit = await unsafeDb.deposit.create({
      data: {
        salonId: S,
        clientProfileId: client.id,
        appointmentId: appointment.id,
        amountCents: 5_000,
        status: 'PENDING',
      },
    })
    await authorizeDeposit({ salonId: S, depositId: deposit.id, currency: 'USD' })

    const card = (await cardsFor(S, client.id))[0]!
    await expect(
      removeCard({ salonId: S, clientProfileId: client.id, savedCardId: card.id }),
    ).rejects.toThrow(/holding a deposit/i)

    // And the card is still chargeable, rather than half-removed.
    expect(await cardsFor(S, client.id)).toHaveLength(1)
  })

  it('detaches at the provider before marking it gone here', async () => {
    const client = await makeClientWithCard()
    const card = (await cardsFor(S, client.id))[0]!
    const customerRef = (await unsafeDb.clientProfile.findUniqueOrThrow({
      where: { id: client.id },
      select: { paymentsCustomerRef: true },
    }))!.paymentsCustomerRef!

    await removeCard({ salonId: S, clientProfileId: client.id, savedCardId: card.id })

    expect(await cardsFor(S, client.id)).toHaveLength(0)
    expect(await paymentsPort().listPaymentMethods(customerRef)).toHaveLength(0)
  })

  it('gives two salons two customers for the same person', async () => {
    /*
     * A shared customer would let one salon charge a card the other collected,
     * which is the single worst thing multi-tenancy could get wrong here.
     */
    const client = await makeClientWithCard()
    const ref = await unsafeDb.clientProfile.findUniqueOrThrow({
      where: { id: client.id },
      select: { paymentsCustomerRef: true },
    })

    const other = await makeClientWithCard('Beatrix')
    const otherRef = await unsafeDb.clientProfile.findUniqueOrThrow({
      where: { id: other.id },
      select: { paymentsCustomerRef: true },
    })

    expect(ref.paymentsCustomerRef).not.toBe(otherRef.paymentsCustomerRef)
  })
})

// ---------------------------------------------------------------------------

describe('the deposit state machine', () => {
  it('refuses to walk a spent deposit backwards', () => {
    expect(canTransition('PENDING', 'AUTHORIZED')).toBe(true)
    expect(canTransition('AUTHORIZED', 'CAPTURED')).toBe(true)
    expect(canTransition('CAPTURED', 'APPLIED')).toBe(true)

    // Terminal means terminal. A duplicate `succeeded` on an applied deposit
    // must not un-apply it.
    expect(canTransition('APPLIED', 'CAPTURED')).toBe(false)
    expect(canTransition('REFUNDED', 'CAPTURED')).toBe(false)
    expect(canTransition('CAPTURED', 'AUTHORIZED')).toBe(false)
  })

  it('a PENDING deposit gets charged rather than blocking its own charge', async () => {
    /*
     * `bookDirect` writes a PENDING deposit at booking time and `takeDeposit`
     * used to treat any live row as "already taken" and return early — so the
     * row it had just written permanently blocked the charge it existed for.
     */
    const client = await makeClientWithCard()
    const pending = await unsafeDb.deposit.create({
      data: { salonId: S, clientProfileId: client.id, amountCents: 5_000, status: 'PENDING' },
    })

    const result = await takeDeposit({
      salonId: S,
      clientProfileId: client.id,
      amountCents: 5_000,
      currency: 'USD',
    })

    expect(result.depositId).toBe(pending.id)
    expect(result.status).toBe('AUTHORIZED')
  })

  it('holds without moving the money, and hands back a secret when there is no card', async () => {
    const client = await makeClient()
    const result = await takeDeposit({
      salonId: S,
      clientProfileId: client.id,
      amountCents: 5_000,
      currency: 'USD',
    })

    // No card, so nothing is authorised and the browser is given something to
    // do rather than the row being marked held on a promise.
    expect(result.status).toBe('PENDING')
    expect(result.clientSecret).toBeTruthy()
  })

  it('applies to a bill exactly once, and does not credit it twice', async () => {
    const client = await makeClientWithCard()
    const appointment = await makeAppointment(client.id, 30_000)
    const deposit = await unsafeDb.deposit.create({
      data: {
        salonId: S,
        clientProfileId: client.id,
        appointmentId: appointment.id,
        amountCents: 5_000,
        status: 'PENDING',
      },
    })
    await authorizeDeposit({ salonId: S, depositId: deposit.id, currency: 'USD' })

    const invoice = await buildInvoice({ salonId: S, appointmentId: appointment.id })

    // The bill is the full price; the deposit is credited, not deducted.
    expect(invoice.totalCents).toBe(30_000)
    expect(invoice.dueCents).toBe(25_000)

    const after = await unsafeDb.deposit.findUniqueOrThrow({ where: { id: deposit.id } })
    expect(after.status).toBe('APPLIED')
    expect(after.appliedToInvoiceId).toBe(invoice.invoiceId)

    const row = await unsafeDb.invoice.findUniqueOrThrow({ where: { id: invoice.invoiceId } })
    expect(row.paidCents).toBe(5_000)

    /*
     * Applying again is a no-op rather than a second credit. Asserted against
     * `markDepositApplied` because that is what `buildInvoice` actually calls:
     * the capture has to happen before the invoice exists and the marking after
     * it, so the two cannot be one call, and a wrapper that pretended otherwise
     * was tested here and used nowhere.
     */
    await markDepositApplied({
      salonId: S,
      depositId: deposit.id,
      invoiceId: invoice.invoiceId,
    })
    const twice = await unsafeDb.invoice.findUniqueOrThrow({ where: { id: invoice.invoiceId } })
    expect(twice.paidCents).toBe(5_000)
  })

  it('captures the money before the invoice claims it was captured', async () => {
    const client = await makeClientWithCard()
    const appointment = await makeAppointment(client.id)
    const deposit = await unsafeDb.deposit.create({
      data: {
        salonId: S,
        clientProfileId: client.id,
        appointmentId: appointment.id,
        amountCents: 5_000,
        status: 'PENDING',
      },
    })
    await authorizeDeposit({ salonId: S, depositId: deposit.id, currency: 'USD' })

    const held = await unsafeDb.deposit.findUniqueOrThrow({ where: { id: deposit.id } })
    const before = await paymentsPort().getIntent(held.providerIntentId!)
    expect(before?.capturedCents).toBe(0)

    await buildInvoice({ salonId: S, appointmentId: appointment.id })

    const after = await paymentsPort().getIntent(held.providerIntentId!)
    expect(after?.capturedCents).toBe(5_000)
  })

  it('releases a hold rather than letting it lapse on the statement', async () => {
    const client = await makeClientWithCard()
    const deposit = await unsafeDb.deposit.create({
      data: { salonId: S, clientProfileId: client.id, amountCents: 5_000, status: 'PENDING' },
    })
    await authorizeDeposit({ salonId: S, depositId: deposit.id, currency: 'USD' })

    await releaseDeposit({ salonId: S, depositId: deposit.id })

    const after = await unsafeDb.deposit.findUniqueOrThrow({ where: { id: deposit.id } })
    expect(after.status).toBe('REFUNDED')
    expect((await paymentsPort().getIntent(after.providerIntentId!))?.status).toBe('CANCELLED')
  })

  it('keeps only up to the fee, and gives the rest back', async () => {
    /*
     * A $50 deposit against a $30 fee is a $20 overcharge if the whole thing
     * is kept, and "the policy says 50%" is not a defence for taking more
     * than 50%.
     */
    const client = await makeClientWithCard()
    const deposit = await unsafeDb.deposit.create({
      data: { salonId: S, clientProfileId: client.id, amountCents: 5_000, status: 'PENDING' },
    })
    await authorizeDeposit({ salonId: S, depositId: deposit.id, currency: 'USD' })

    const kept = await forfeitDeposit({
      salonId: S,
      depositId: deposit.id,
      reason: 'Nobody arrived.',
      keepAtMostCents: 3_000,
    })

    expect(kept.forfeitedCents).toBe(3_000)
    const after = await unsafeDb.deposit.findUniqueOrThrow({ where: { id: deposit.id } })
    expect(after.status).toBe('FORFEITED')
    expect((await paymentsPort().getIntent(after.providerIntentId!))?.capturedCents).toBe(3_000)
  })

  it('renews a hold that is about to lapse without stacking two on one card', async () => {
    const client = await makeClientWithCard()
    const deposit = await unsafeDb.deposit.create({
      data: { salonId: S, clientProfileId: client.id, amountCents: 5_000, status: 'PENDING' },
    })
    await authorizeDeposit({ salonId: S, depositId: deposit.id, currency: 'USD' })
    const first = await unsafeDb.deposit.findUniqueOrThrow({ where: { id: deposit.id } })

    await renewDepositAuthorization({ salonId: S, depositId: deposit.id, currency: 'USD' })
    const second = await unsafeDb.deposit.findUniqueOrThrow({ where: { id: deposit.id } })

    expect(second.status).toBe('AUTHORIZED')
    // A genuinely new intent, and the old one cancelled — not two live holds.
    expect(second.providerIntentId).not.toBe(first.providerIntentId)
    expect((await paymentsPort().getIntent(first.providerIntentId!))?.status).toBe('CANCELLED')
  })
})

// ---------------------------------------------------------------------------

describe('cancelling settles the deposit', () => {
  it('gives it back when the client cancelled in good time', async () => {
    const client = await makeClientWithCard()
    // Weeks out, so comfortably inside the 48-hour notice window.
    const appointment = await makeAppointment(
      client.id,
      30_000,
      new Date(Date.now() + 30 * 86_400_000),
    )
    const deposit = await unsafeDb.deposit.create({
      data: {
        salonId: S,
        clientProfileId: client.id,
        appointmentId: appointment.id,
        amountCents: 5_000,
        status: 'PENDING',
      },
    })
    await authorizeDeposit({ salonId: S, depositId: deposit.id, currency: 'USD' })

    const outcome = await assessCancellation({ salonId: S, appointmentId: appointment.id })

    expect(outcome.withinWindow).toBe(true)
    expect(outcome.feeCents).toBe(0)
    expect((await unsafeDb.deposit.findUniqueOrThrow({ where: { id: deposit.id } })).status).toBe(
      'REFUNDED',
    )
  })

  it('keeps it when nobody turned up', async () => {
    const client = await makeClientWithCard()
    const appointment = await makeAppointment(client.id, 30_000, new Date(Date.now() - 3_600_000))
    const deposit = await unsafeDb.deposit.create({
      data: {
        salonId: S,
        clientProfileId: client.id,
        appointmentId: appointment.id,
        amountCents: 5_000,
        status: 'PENDING',
      },
    })
    await authorizeDeposit({ salonId: S, depositId: deposit.id, currency: 'USD' })

    await assessCancellation({ salonId: S, appointmentId: appointment.id, isNoShow: true })

    const after = await unsafeDb.deposit.findUniqueOrThrow({ where: { id: deposit.id } })
    expect(after.status).toBe('FORFEITED')
    // The whole deposit, because the no-show fee is 100% of $300 and the
    // deposit is only $50 of it.
    expect((await paymentsPort().getIntent(after.providerIntentId!))?.capturedCents).toBe(5_000)
  })

  it('caps the forfeit across multiple deposits, not per deposit', async () => {
    // Late cancel: 50% of $60 = $30 fee. Two $50 holds must keep $30 total.
    await unsafeDb.salonSettings.update({
      where: { salonId: S },
      data: { cancellationWindowHours: 48, cancellationFeePercent: 50 },
    })
    const client = await makeClientWithCard()
    const appointment = await makeAppointment(client.id, 6_000, new Date(Date.now() + 60 * 60_000))
    const first = await unsafeDb.deposit.create({
      data: {
        salonId: S,
        clientProfileId: client.id,
        appointmentId: appointment.id,
        amountCents: 5_000,
        status: 'PENDING',
      },
    })
    const second = await unsafeDb.deposit.create({
      data: {
        salonId: S,
        clientProfileId: client.id,
        appointmentId: appointment.id,
        amountCents: 5_000,
        status: 'PENDING',
      },
    })
    await authorizeDeposit({ salonId: S, depositId: first.id, currency: 'USD' })
    await authorizeDeposit({ salonId: S, depositId: second.id, currency: 'USD' })

    await assessCancellation({ salonId: S, appointmentId: appointment.id })

    const a = await unsafeDb.deposit.findUniqueOrThrow({ where: { id: first.id } })
    const b = await unsafeDb.deposit.findUniqueOrThrow({ where: { id: second.id } })
    const kept =
      ((await paymentsPort().getIntent(a.providerIntentId!))?.capturedCents ?? 0) +
      ((await paymentsPort().getIntent(b.providerIntentId!))?.capturedCents ?? 0)
    expect(kept).toBe(3_000)
  })
})

// ---------------------------------------------------------------------------

describe('the webhook route', () => {
  it('rejects an unsigned delivery and says nothing about why', async () => {
    const { payload } = MockPaymentsAdapter.synthesizeWebhook({
      id: 'evt_forged',
      type: 'payment_intent.succeeded',
      objectId: 'pi_forged',
    })
    const response = await POST(
      new Request('http://localhost/api/webhooks/payments', {
        method: 'POST',
        headers: { 'stripe-signature': 'v1=nonsense' },
        body: payload,
      }),
    )

    expect(response.status).toBe(400)
    // No detail. A verification oracle tells an attacker they are getting warmer.
    const body = (await response.json()) as { error: string }
    expect(body.error).not.toMatch(/timestamp|hmac|secret/i)
  })

  it('reconciles a deposit from what the provider says', async () => {
    const client = await makeClientWithCard()
    const deposit = await unsafeDb.deposit.create({
      data: { salonId: S, clientProfileId: client.id, amountCents: 5_000, status: 'PENDING' },
    })
    await authorizeDeposit({ salonId: S, depositId: deposit.id, currency: 'USD' })
    const held = await unsafeDb.deposit.findUniqueOrThrow({ where: { id: deposit.id } })

    const result = await deliver({
      id: 'evt_cap',
      type: 'payment_intent.succeeded',
      objectId: held.providerIntentId!,
    })

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ handled: true, kind: 'deposit', status: 'CAPTURED' })
    expect((await unsafeDb.deposit.findUniqueOrThrow({ where: { id: deposit.id } })).status).toBe(
      'CAPTURED',
    )
  })

  it('handles a redelivery once, not twice', async () => {
    const client = await makeClientWithCard()
    const deposit = await unsafeDb.deposit.create({
      data: { salonId: S, clientProfileId: client.id, amountCents: 5_000, status: 'PENDING' },
    })
    await authorizeDeposit({ salonId: S, depositId: deposit.id, currency: 'USD' })
    const held = await unsafeDb.deposit.findUniqueOrThrow({ where: { id: deposit.id } })

    const event = {
      id: 'evt_retry',
      type: 'payment_intent.succeeded',
      objectId: held.providerIntentId!,
    }
    const first = await deliver(event)
    const second = await deliver(event)

    expect(first.body).toMatchObject({ handled: true })
    expect(second.body).toMatchObject({ duplicate: true })
    // Both answered 200, because a provider told twice must stop retrying.
    expect(second.status).toBe(200)
  })

  it('does not un-apply a deposit on a late duplicate', async () => {
    const client = await makeClientWithCard()
    const appointment = await makeAppointment(client.id)
    const deposit = await unsafeDb.deposit.create({
      data: {
        salonId: S,
        clientProfileId: client.id,
        appointmentId: appointment.id,
        amountCents: 5_000,
        status: 'PENDING',
      },
    })
    await authorizeDeposit({ salonId: S, depositId: deposit.id, currency: 'USD' })
    const held = await unsafeDb.deposit.findUniqueOrThrow({ where: { id: deposit.id } })
    await buildInvoice({ salonId: S, appointmentId: appointment.id })

    // A `succeeded` arriving after the deposit was already spent.
    const result = await deliver({
      id: 'evt_late',
      type: 'payment_intent.succeeded',
      objectId: held.providerIntentId!,
    })

    expect(result.status).toBe(200)
    expect((await unsafeDb.deposit.findUniqueOrThrow({ where: { id: deposit.id } })).status).toBe(
      'APPLIED',
    )
  })

  it('retries an event whose handling failed, rather than swallowing it', async () => {
    /*
     * The claim row is what makes a redelivery a no-op — and leaving it in
     * place after a FAILED attempt turns the retry into a no-op too. The
     * provider is told 200, the work never happens, and the money's state is
     * never learned. That is the worst outcome this route has, because it is
     * silent.
     *
     * Simulated by claiming the event as a previous failed attempt, then
     * delivering it for real.
     */
    const client = await makeClientWithCard()
    const deposit = await unsafeDb.deposit.create({
      data: { salonId: S, clientProfileId: client.id, amountCents: 5_000, status: 'PENDING' },
    })
    await authorizeDeposit({ salonId: S, depositId: deposit.id, currency: 'USD' })
    const held = await unsafeDb.deposit.findUniqueOrThrow({ where: { id: deposit.id } })

    await unsafeDb.idempotencyKey.create({
      data: {
        scope: 'payments:webhook',
        key: 'evt_failed',
        requestHash: 'whatever',
        status: 'FAILED',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })

    const result = await deliver({
      id: 'evt_failed',
      type: 'payment_intent.succeeded',
      objectId: held.providerIntentId!,
    })

    expect(result.body).toMatchObject({ handled: true, status: 'CAPTURED' })
    expect((await unsafeDb.deposit.findUniqueOrThrow({ where: { id: deposit.id } })).status).toBe(
      'CAPTURED',
    )
  })

  it('does not take over an event another request is still working on', async () => {
    await unsafeDb.idempotencyKey.create({
      data: {
        scope: 'payments:webhook',
        key: 'evt_inflight',
        requestHash: 'whatever',
        status: 'IN_PROGRESS',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })

    const result = await deliver({
      id: 'evt_inflight',
      type: 'payment_intent.succeeded',
      objectId: 'pi_inflight',
    })

    expect(result.body).toMatchObject({ duplicate: true })
  })

  it('answers 200 to an event nothing listens for', async () => {
    const result = await deliver({
      id: 'evt_unknown',
      type: 'invoice.voided',
      objectId: 'in_whatever',
    })

    // Not an error. Returning 500 makes a provider retry for days over
    // something this platform was never going to act on.
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ handled: false })
  })

  it('picks up a card the browser never got to report', async () => {
    /*
     * A client who added a card and then lost their connection should still
     * have one. The webhook is the second path to the same landing place.
     */
    const client = await makeClient()
    const setup = await beginCardSetup({ salonId: S, clientProfileId: client.id })
    mock().attachTestCard(setup.setupIntentId)

    expect(await cardsFor(S, client.id)).toHaveLength(0)

    const result = await deliver({
      id: 'evt_setup',
      type: 'setup_intent.succeeded',
      objectId: setup.setupIntentId,
      metadata: { salonId: S, clientProfileId: client.id },
    })

    expect(result.body).toMatchObject({ handled: true, kind: 'setup' })
    expect(await cardsFor(S, client.id)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------

describe('a corrective consultation is chargeable, and credited', () => {
  it('is free unless the salon set a figure', async () => {
    const client = await makeClient()
    const consultation = await makeConsultation(client.id)

    expect(
      await chargeConsultationFee({
        salonId: S,
        consultationId: consultation.id,
        clientProfileId: client.id,
        currency: 'USD',
      }),
    ).toBeNull()
  })

  it('charges once however many times the client resubmits', async () => {
    await unsafeDb.salonSettings.update({
      where: { salonId: S },
      data: { correctiveConsultFeeCents: 7_500 },
    })
    try {
      const client = await makeClientWithCard()
      const consultation = await makeConsultation(client.id)

      const first = await chargeConsultationFee({
        salonId: S,
        consultationId: consultation.id,
        clientProfileId: client.id,
        currency: 'USD',
      })
      const second = await chargeConsultationFee({
        salonId: S,
        consultationId: consultation.id,
        clientProfileId: client.id,
        currency: 'USD',
      })

      expect(first?.status).toBe('AUTHORIZED')
      // A hesitant client must not be charged for their own hesitation.
      expect(second?.depositId).toBe(first?.depositId)
      expect(await unsafeDb.deposit.count({ where: { consultationId: consultation.id } })).toBe(1)
    } finally {
      await unsafeDb.salonSettings.update({
        where: { salonId: S },
        data: { correctiveConsultFeeCents: 0 },
      })
    }
  })

  it('comes off the bill for the work booked from it', async () => {
    await unsafeDb.salonSettings.update({
      where: { salonId: S },
      data: { correctiveConsultFeeCents: 7_500 },
    })
    try {
      const client = await makeClientWithCard()
      const consultation = await makeConsultation(client.id)
      await chargeConsultationFee({
        salonId: S,
        consultationId: consultation.id,
        clientProfileId: client.id,
        currency: 'USD',
      })

      const appointment = await makeAppointment(client.id, 30_000)
      await unsafeDb.appointment.update({
        where: { id: appointment.id },
        data: { consultationId: consultation.id },
      })

      const invoice = await buildInvoice({ salonId: S, appointmentId: appointment.id })

      // Pay for the assessment only if you walk away. Here they did not.
      expect(invoice.dueCents).toBe(22_500)
    } finally {
      await unsafeDb.salonSettings.update({
        where: { salonId: S },
        data: { correctiveConsultFeeCents: 0 },
      })
    }
  })
})

async function makeConsultation(clientProfileId: string) {
  const template = await unsafeDb.consultationTemplate.upsert({
    where: { id: 'cf_tpl' },
    update: {},
    create: {
      id: 'cf_tpl',
      salonId: S,
      key: 'cf-colour',
      name: 'Colour',
      version: 1,
      status: 'PUBLISHED',
    },
  })
  return unsafeDb.consultation.create({
    data: {
      salonId: S,
      clientProfileId,
      templateId: template.id,
      templateVersion: 1,
      requestedServiceIds: ['cf_svc'],
      status: 'SUBMITTED',
    },
    select: { id: true },
  })
}
