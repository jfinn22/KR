import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { MockPaymentsAdapter } from '@/ports/payments'
import { paymentsPort } from '@/ports/registry'
import { beginCardSetup, syncCards } from '@/server/services/cards'
import {
  assessCancellation,
  buildInvoice,
  loadInvoice,
  refundPayment,
  quoteDeposit,
  takeDeposit,
  takePayment,
  waiveCancellationFee,
} from '@/server/services/commerce'
import {
  consentState,
  eraseClient,
  exportClientData,
  grantConsent,
  hasConsent,
  readPatchTest,
  recordPatchTest,
  revokeConsent,
  submitForm,
  validPatchTest,
  verifySubmission,
} from '@/server/services/compliance'

/**
 * Money and consent against a real database. The behaviours that matter most
 * are the ones that are expensive to get wrong: a double-tap must not double
 * charge, a patch test must not be readable as clear too early, and erasure
 * must remove the person without destroying the salon's books.
 */

const S = 'cm_salon'

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'cm-salon',
      name: 'Commerce Test Salon',
      currency: 'USD',
      settings: {
        create: {
          cancellationWindowHours: 48,
          cancellationFeePercent: 50,
          noShowFeePercent: 100,
          depositCapCents: 50000,
        },
      },
      locations: { create: { id: 'cm_loc', name: 'Main' } },
      serviceCategories: { create: { id: 'cm_cat', name: 'Colour', slug: 'colour' } },
      depositPolicies: {
        create: {
          id: 'cm_dep',
          name: 'Standard',
          mode: 'PERCENT',
          percentBps: 2000,
          minCents: 2500,
          refundableUntilHours: 48,
          isDefault: true,
        },
      },
    },
  })

  await unsafeDb.user.create({ data: { id: 'cm_user', email: 'cm-owner@example.com' } })
  await unsafeDb.membership.create({
    data: { id: 'cm_mem', salonId: S, userId: 'cm_user', role: 'OWNER' },
  })
  await unsafeDb.stylistProfile.create({
    data: { id: 'cm_sty', salonId: S, membershipId: 'cm_mem', displayName: 'Rowan' },
  })

  await unsafeDb.service.create({
    data: {
      id: 'cm_svc',
      salonId: S,
      categoryId: 'cm_cat',
      name: 'Full balayage',
      slug: 'balayage',
      basePriceCents: 22000,
      baseComplexity: 15,
      isChemical: true,
      isLightening: true,
    },
  })

  await unsafeDb.formTemplate.create({
    data: {
      id: 'cm_form',
      salonId: S,
      key: 'chemical-consent',
      version: 1,
      name: 'Chemical service consent',
      kind: 'CHEMICAL_SERVICE',
      bodyMarkdown: 'I understand that chemical services carry risk.',
      requiresSignature: true,
      status: 'PUBLISHED',
      isLegalPlaceholder: true,
    },
  })
}

beforeAll(seed, 90_000)

beforeEach(async () => {
  await unsafeDb.auditLog.deleteMany({ where: { salonId: S } })
  await unsafeDb.refund.deleteMany({ where: { salonId: S } })
  await unsafeDb.payment.deleteMany({ where: { salonId: S } })
  await unsafeDb.invoice.deleteMany({ where: { salonId: S } })
  await unsafeDb.deposit.deleteMany({ where: { salonId: S } })
  await unsafeDb.cancellationFee.deleteMany({ where: { salonId: S } })
  await unsafeDb.appointment.deleteMany({ where: { salonId: S } })
  await unsafeDb.formSubmission.deleteMany({ where: { salonId: S } })
  await unsafeDb.consentGrant.deleteMany({ where: { salonId: S } })
  await unsafeDb.patchTest.deleteMany({ where: { salonId: S } })
  await unsafeDb.clientProfile.deleteMany({ where: { salonId: S } })
})

afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'cm-' } } })
  await unsafeDb.$disconnect()
})

async function makeClient(id = 'cm_cli') {
  return unsafeDb.clientProfile.create({
    data: {
      id,
      salonId: S,
      firstName: 'Ada',
      lastName: 'Rivera',
      email: `${id}@example.com`,
      phone: '+15551234567',
      hairProfile: { create: { salonId: S, naturalLevel: 5 } },
    },
  })
}

/**
 * A client with a card on file.
 *
 * The precondition for a deposit ever reaching AUTHORIZED. Before Phase 5 a
 * deposit was marked held the moment an intent was created, with nothing
 * behind it to hold — so these tests passed against a hold that did not exist.
 */
async function makeClientWithCard(id = 'cm_cli') {
  const client = await makeClient(id)
  const setup = await beginCardSetup({ salonId: S, clientProfileId: client.id })
  const port = paymentsPort()
  if (!(port instanceof MockPaymentsAdapter)) throw new Error('Needs the mock adapter.')
  port.attachTestCard(setup.setupIntentId)
  await syncCards({ salonId: S, clientProfileId: client.id })
  return client
}

async function makeAppointment(clientId: string, startsAt: Date, totalCents = 22000) {
  return unsafeDb.appointment.create({
    data: {
      salonId: S,
      locationId: 'cm_loc',
      clientProfileId: clientId,
      primaryStylistId: 'cm_sty',
      status: 'COMPLETED',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 3_600_000),
      estimatedDurationMin: 180,
      estimatedTotalCents: totalCents,
      services: {
        create: {
          salonId: S,
          serviceId: 'cm_svc',
          stylistProfileId: 'cm_sty',
          sequence: 0,
          plannedDurationMin: 180,
          priceCents: totalCents,
        },
      },
    },
  })
}

describe('deposits', () => {
  /*
   * Commerce is the money authority now. The rules engine returns a risk band
   * and nothing else; `quoteDeposit` turns that into cents from the salon's own
   * policy, and `takeDeposit` charges exactly the figure it was handed. Before
   * this, the engine computed one number from hardcoded percentages nobody had
   * seen and the till computed a different one from the policy row — a client
   * quoted one figure and asked for another, with nothing comparing the two.
   */
  it('quotes the salon policy percentage against the basket', async () => {
    const quote = await quoteDeposit({
      salonId: S,
      serviceIds: ['cm_svc'],
      band: 2,
      serviceTotalCents: 22000,
    })
    expect(quote.amountCents).toBe(4400)
    expect(quote.source).toBe('SALON_POLICY')
  })

  it('authorises rather than captures, when there is a card to authorise', async () => {
    const client = await makeClientWithCard()
    const result = await takeDeposit({
      salonId: S,
      clientProfileId: client.id,
      amountCents: 4400,
      currency: 'USD',
    })

    expect(result.amountCents).toBe(4400)

    const row = await unsafeDb.deposit.findUniqueOrThrow({ where: { id: result.depositId! } })
    // Held, not taken. The money only moves if they do not turn up.
    expect(row.status).toBe('AUTHORIZED')
    expect(row.refundableUntil).not.toBeNull()
    expect(row.policySnapshotJson).toBeTruthy()
  })

  it('stays owed, not held, when there is no card behind it', async () => {
    /*
     * This used to come back AUTHORIZED. An intent was created with no
     * customer and no payment method, and the row was marked held on the
     * strength of it — a hold nobody had agreed to, recorded as if they had,
     * against a card that was never asked. Nothing was ever capturable.
     */
    const client = await makeClient()
    const result = await takeDeposit({
      salonId: S,
      clientProfileId: client.id,
      amountCents: 4400,
      currency: 'USD',
    })

    expect(result.status).toBe('PENDING')
    // The browser gets something to do instead: a secret to confirm with.
    expect(result.clientSecret).toBeTruthy()
    expect(
      (await unsafeDb.deposit.findUniqueOrThrow({ where: { id: result.depositId! } })).status,
    ).toBe('PENDING')
  })

  // The double-tap is the most common cause of a duplicate charge.
  it('a second attempt returns the same deposit, not a second one', async () => {
    const client = await makeClient()
    const args = {
      salonId: S,
      clientProfileId: client.id,
      amountCents: 4400,
      currency: 'USD',
    }

    const first = await takeDeposit(args)
    const second = await takeDeposit(args)

    expect(second.depositId).toBe(first.depositId)
    expect(await unsafeDb.deposit.count({ where: { salonId: S } })).toBe(1)
  })

  it('takes nothing when nothing is owed', async () => {
    const client = await makeClient()
    const result = await takeDeposit({
      salonId: S,
      clientProfileId: client.id,
      amountCents: 0,
      currency: 'USD',
    })
    expect(result.amountCents).toBe(0)
    expect(result.depositId).toBeNull()
  })

  /*
   * The risk band may raise the figure and never lower it. A salon that says
   * 20% means at least 20%; the engine deciding somebody is low-risk is not
   * permission to charge them less than the salon's own terms.
   */
  it('never quotes below the salon policy, whatever the band says', async () => {
    const low = await quoteDeposit({
      salonId: S,
      serviceIds: ['cm_svc'],
      band: 1,
      serviceTotalCents: 22000,
    })
    expect(low.amountCents).toBe(4400)
    expect(low.raisedByRisk).toBe(false)
  })

  it('prefers the policy attached to the service over the salon default', async () => {
    const policy = await unsafeDb.depositPolicy.create({
      data: {
        salonId: S,
        name: 'Corrective',
        mode: 'PERCENT',
        percentBps: 5000,
        minCents: 10000,
        refundableUntilHours: 72,
      },
      select: { id: true },
    })
    // Read for the first time here: `Service.depositPolicyId` has been in the
    // schema since it was written and had zero references in src/.
    await unsafeDb.service.update({
      where: { id: 'cm_svc' },
      data: { depositPolicyId: policy.id },
    })

    try {
      const quote = await quoteDeposit({
        salonId: S,
        serviceIds: ['cm_svc'],
        band: 2,
        serviceTotalCents: 22000,
      })
      expect(quote.amountCents).toBe(11000)
      expect(quote.source).toBe('SERVICE_POLICY')
    } finally {
      await unsafeDb.service.update({ where: { id: 'cm_svc' }, data: { depositPolicyId: null } })
      await unsafeDb.depositPolicy.delete({ where: { id: policy.id } })
    }
  })
})

describe('invoicing', () => {
  it('bills what was agreed on the appointment', async () => {
    const client = await makeClient()
    const appointment = await makeAppointment(client.id, new Date('2026-08-01T14:00:00Z'))

    const invoice = await buildInvoice({
      salonId: S,
      appointmentId: appointment.id,
      taxRateBps: 2000,
    })

    expect(invoice.totalCents).toBe(22000 + 4400)

    const loaded = await loadInvoice(S, invoice.invoiceId)
    expect(loaded.lines).toHaveLength(1)
    expect(loaded.number).toMatch(/^\d{6}$/)
  })

  it('applies a deposit already held against what is due', async () => {
    const client = await makeClientWithCard()
    const appointment = await makeAppointment(client.id, new Date('2026-08-01T14:00:00Z'))

    await takeDeposit({
      salonId: S,
      clientProfileId: client.id,
      appointmentId: appointment.id,
      amountCents: 4400,
      currency: 'USD',
    })

    const invoice = await buildInvoice({ salonId: S, appointmentId: appointment.id })
    expect(invoice.totalCents).toBe(22000)
    expect(invoice.dueCents).toBe(22000 - 4400)
  })

  it('refuses to invoice the same appointment twice', async () => {
    const client = await makeClient()
    const appointment = await makeAppointment(client.id, new Date('2026-08-01T14:00:00Z'))

    await buildInvoice({ salonId: S, appointmentId: appointment.id })
    await expect(buildInvoice({ salonId: S, appointmentId: appointment.id })).rejects.toThrow(
      /already been invoiced/,
    )
  })

  it('numbers invoices sequentially per salon', async () => {
    const clientA = await makeClient('cm_a')
    const clientB = await makeClient('cm_b')
    const a = await makeAppointment(clientA.id, new Date('2026-08-01T10:00:00Z'))
    const b = await makeAppointment(clientB.id, new Date('2026-08-01T14:00:00Z'))

    const first = await buildInvoice({ salonId: S, appointmentId: a.id })
    const second = await buildInvoice({ salonId: S, appointmentId: b.id })

    const numbers = await Promise.all([
      loadInvoice(S, first.invoiceId),
      loadInvoice(S, second.invoiceId),
    ])
    expect(Number(numbers[1].number)).toBe(Number(numbers[0].number) + 1)
  })
})

describe('payments', () => {
  async function billedAppointment() {
    const client = await makeClient()
    const appointment = await makeAppointment(client.id, new Date('2026-08-01T14:00:00Z'))
    const invoice = await buildInvoice({ salonId: S, appointmentId: appointment.id })
    return invoice
  }

  it('settles the bill and marks it paid', async () => {
    const invoice = await billedAppointment()
    const result = await takePayment({
      salonId: S,
      invoiceId: invoice.invoiceId,
      amountCents: 22000,
      method: 'CARD',
      currency: 'USD',
    })

    expect(result.remainingCents).toBe(0)
    expect((await loadInvoice(S, invoice.invoiceId)).status).toBe('PAID')
  })

  it('records a part payment without closing the bill', async () => {
    const invoice = await billedAppointment()
    const result = await takePayment({
      salonId: S,
      invoiceId: invoice.invoiceId,
      amountCents: 10000,
      method: 'CASH',
      currency: 'USD',
    })

    expect(result.remainingCents).toBe(12000)
    expect((await loadInvoice(S, invoice.invoiceId)).status).toBe('PARTIALLY_PAID')
  })

  // The behaviour a flaky connection would otherwise turn into a double charge.
  it('a retry carrying the same key does not charge twice', async () => {
    const invoice = await billedAppointment()
    const args = {
      salonId: S,
      invoiceId: invoice.invoiceId,
      amountCents: 10000,
      method: 'CARD' as const,
      currency: 'USD',
      idempotencyKey: 'attempt-1',
    }

    const first = await takePayment(args)
    const second = await takePayment(args)

    expect(second.paymentId).toBe(first.paymentId)
    expect(await unsafeDb.payment.count({ where: { salonId: S } })).toBe(1)
  })

  /*
   * The other half of the contract, and the reason the key cannot be derived
   * from the running total: two part-payments of the same amount toward one
   * bill are legitimate and must both go through.
   */
  it('two genuine part-payments of the same amount both go through', async () => {
    const invoice = await billedAppointment()
    const base = {
      salonId: S,
      invoiceId: invoice.invoiceId,
      amountCents: 10000,
      method: 'CASH' as const,
      currency: 'USD',
    }

    await takePayment({ ...base, idempotencyKey: 'attempt-1' })
    const second = await takePayment({ ...base, idempotencyKey: 'attempt-2' })

    expect(second.paidCents).toBe(20000)
    expect(await unsafeDb.payment.count({ where: { salonId: S } })).toBe(2)
  })

  it('refuses to take money against a settled bill', async () => {
    const invoice = await billedAppointment()
    await takePayment({
      salonId: S,
      invoiceId: invoice.invoiceId,
      amountCents: 22000,
      method: 'CASH',
      currency: 'USD',
    })

    await expect(
      takePayment({
        salonId: S,
        invoiceId: invoice.invoiceId,
        amountCents: 100,
        method: 'CASH',
        currency: 'USD',
      }),
    ).rejects.toThrow(/already settled/)
  })

  it('refunds up to what was captured and no further', async () => {
    const invoice = await billedAppointment()
    const payment = await takePayment({
      salonId: S,
      invoiceId: invoice.invoiceId,
      amountCents: 22000,
      method: 'CARD',
      currency: 'USD',
    })

    await refundPayment({
      salonId: S,
      paymentId: payment.paymentId,
      amountCents: 5000,
      reason: 'Toner was not what she asked for.',
    })

    await expect(
      refundPayment({
        salonId: S,
        paymentId: payment.paymentId,
        amountCents: 20000,
        reason: 'Too much.',
      }),
    ).rejects.toThrow(/still refundable/)
  })
})

describe('cancellation', () => {
  const scheduled = new Date(Date.now() + 5 * 86_400_000)

  it('charges nothing with enough notice, and still records it', async () => {
    const client = await makeClient()
    const appointment = await makeAppointment(client.id, scheduled)

    const outcome = await assessCancellation({
      salonId: S,
      appointmentId: appointment.id,
      cancelledAt: new Date(),
    })

    expect(outcome.feeCents).toBe(0)
    expect(outcome.withinWindow).toBe(true)

    // The record exists even at zero: it is what settles the argument later.
    const fee = await unsafeDb.cancellationFee.findUniqueOrThrow({
      where: { appointmentId: appointment.id },
    })
    expect(fee.status).toBe('WAIVED')
    expect(fee.policySnapshotJson).toBeTruthy()
  })

  it('charges the late rate inside the window', async () => {
    const client = await makeClient()
    const soon = new Date(Date.now() + 6 * 3_600_000)
    const appointment = await makeAppointment(client.id, soon)

    const outcome = await assessCancellation({ salonId: S, appointmentId: appointment.id })
    expect(outcome.feeCents).toBe(11000)
  })

  it('offsets a deposit already held', async () => {
    const client = await makeClientWithCard()
    const soon = new Date(Date.now() + 6 * 3_600_000)
    const appointment = await makeAppointment(client.id, soon)

    await takeDeposit({
      salonId: S,
      clientProfileId: client.id,
      appointmentId: appointment.id,
      amountCents: 4400,
      currency: 'USD',
    })

    const outcome = await assessCancellation({ salonId: S, appointmentId: appointment.id })
    expect(outcome.feeCents).toBe(11000 - 4400)
  })

  it('can be waived with a reason', async () => {
    const client = await makeClient()
    const soon = new Date(Date.now() + 6 * 3_600_000)
    const appointment = await makeAppointment(client.id, soon)

    await assessCancellation({ salonId: S, appointmentId: appointment.id })
    await waiveCancellationFee({
      salonId: S,
      appointmentId: appointment.id,
      reason: 'Her train was cancelled.',
      userId: 'cm_user',
    })

    const fee = await unsafeDb.cancellationFee.findUniqueOrThrow({
      where: { appointmentId: appointment.id },
    })
    expect(fee.status).toBe('WAIVED')
    expect(fee.waiveReason).toContain('train')
  })
})

describe('patch tests', () => {
  it('records one and computes when it can be read and when it expires', async () => {
    const client = await makeClient()
    const appliedAt = new Date('2026-08-01T10:00:00Z')

    const result = await recordPatchTest({
      salonId: S,
      clientProfileId: client.id,
      appliedAt,
    })

    expect(result.readableFrom.getTime()).toBe(appliedAt.getTime() + 48 * 3_600_000)
    expect(result.validUntil.getTime()).toBe(appliedAt.getTime() + 180 * 86_400_000)
  })

  /*
   * A test read at four hours and filed as clear is worse than no test: it
   * puts a "safe" record on file that the rules engine will believe.
   */
  it('refuses to be read as clear before the reaction window has passed', async () => {
    const client = await makeClient()
    const appliedAt = new Date()

    const { patchTestId } = await recordPatchTest({
      salonId: S,
      clientProfileId: client.id,
      appliedAt,
    })

    await expect(
      readPatchTest({
        salonId: S,
        patchTestId,
        result: 'NEGATIVE',
        readAt: new Date(appliedAt.getTime() + 4 * 3_600_000),
      }),
    ).rejects.toThrow(/48 hours/)
  })

  it('accepts a positive result immediately — a reaction is a reaction', async () => {
    const client = await makeClient()
    const appliedAt = new Date()

    const { patchTestId } = await recordPatchTest({
      salonId: S,
      clientProfileId: client.id,
      appliedAt,
    })

    await readPatchTest({
      salonId: S,
      patchTestId,
      result: 'POSITIVE',
      readAt: new Date(appliedAt.getTime() + 3 * 3_600_000),
    })

    // And it becomes a permanent fact about the client, not just this test.
    const profile = await unsafeDb.hairProfile.findFirstOrThrow({
      where: { clientProfileId: client.id },
    })
    expect(profile.priorReactionToColor).toBe(true)
  })

  it('treats an expired test as absent, never as a weaker yes', async () => {
    const client = await makeClient()
    const appliedAt = new Date(Date.now() - 200 * 86_400_000)

    const { patchTestId } = await recordPatchTest({
      salonId: S,
      clientProfileId: client.id,
      appliedAt,
    })
    await readPatchTest({
      salonId: S,
      patchTestId,
      result: 'NEGATIVE',
      readAt: new Date(appliedAt.getTime() + 72 * 3_600_000),
    })

    expect(await validPatchTest(S, client.id)).toBeNull()
  })

  it('finds a current one', async () => {
    const client = await makeClient()
    const appliedAt = new Date(Date.now() - 10 * 86_400_000)

    const { patchTestId } = await recordPatchTest({
      salonId: S,
      clientProfileId: client.id,
      appliedAt,
    })
    await readPatchTest({
      salonId: S,
      patchTestId,
      result: 'NEGATIVE',
      readAt: new Date(appliedAt.getTime() + 72 * 3_600_000),
    })

    expect(await validPatchTest(S, client.id)).not.toBeNull()
  })
})

describe('forms and consent', () => {
  it('records a signature against a hash of what was actually shown', async () => {
    const client = await makeClient()

    const result = await submitForm({
      salonId: S,
      formKey: 'chemical-consent',
      clientProfileId: client.id,
      signerName: 'Ada Rivera',
    })

    expect(result.documentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.isLegalPlaceholder).toBe(true)

    const verified = await verifySubmission(S, result.submissionId)
    expect(verified.matches).toBe(true)
  })

  /*
   * The point of hashing: editing the template afterwards must not silently
   * change what the record says somebody agreed to.
   */
  it('notices when the template was edited after signing', async () => {
    const client = await makeClient()
    const result = await submitForm({
      salonId: S,
      formKey: 'chemical-consent',
      clientProfileId: client.id,
      signerName: 'Ada Rivera',
    })

    await unsafeDb.formTemplate.update({
      where: { id: 'cm_form' },
      data: { bodyMarkdown: 'Completely different terms.' },
    })

    const verified = await verifySubmission(S, result.submissionId)
    expect(verified.matches).toBe(false)

    await unsafeDb.formTemplate.update({
      where: { id: 'cm_form' },
      data: { bodyMarkdown: 'I understand that chemical services carry risk.' },
    })
  })

  it('a signed consent form grants the consent it describes', async () => {
    const client = await makeClient()
    await submitForm({
      salonId: S,
      formKey: 'chemical-consent',
      clientProfileId: client.id,
      signerName: 'Ada Rivera',
    })

    expect(await hasConsent(S, client.id, 'CHEMICAL_SERVICE')).toBe(true)
  })

  // Revoked, not deleted: the record is the evidence the salon stopped.
  it('withdrawing consent leaves a record that it was withdrawn', async () => {
    const client = await makeClient()
    await grantConsent({ salonId: S, clientProfileId: client.id, kind: 'MARKETING_USE' })
    expect(await hasConsent(S, client.id, 'MARKETING_USE')).toBe(true)

    await revokeConsent({ salonId: S, clientProfileId: client.id, kind: 'MARKETING_USE' })
    expect(await hasConsent(S, client.id, 'MARKETING_USE')).toBe(false)

    const state = await consentState(S, client.id)
    const grant = state.grants.find((g) => g.kind === 'MARKETING_USE')
    expect(grant?.status).toBe('REVOKED')
    expect(grant?.revokedAt).not.toBeNull()
  })
})

describe('subject rights', () => {
  it('exports something a person could actually read', async () => {
    const client = await makeClient()
    await makeAppointment(client.id, new Date('2026-07-01T14:00:00Z'))

    const data = await exportClientData(S, client.id)

    expect(data.client.firstName).toBe('Ada')
    expect(data.appointments).toHaveLength(1)
    expect(data.appointments[0]!.services).toContain('Full balayage')
    expect(data.exportedAt).toBeTruthy()
  })

  /*
   * The balance the whole design turns on: the person goes, the books stay.
   * A salon still has to account for money taken and services performed.
   */
  it('erasure removes the identity and keeps the accounting', async () => {
    const client = await makeClient()
    const appointment = await makeAppointment(client.id, new Date('2026-07-01T14:00:00Z'))
    await buildInvoice({ salonId: S, appointmentId: appointment.id })

    const result = await eraseClient({
      salonId: S,
      clientProfileId: client.id,
      requestedByUserId: 'cm_user',
      reason: 'Erasure request received 2026-08-02.',
    })

    expect(result.appointmentsRetained).toBe(1)

    const erased = await unsafeDb.clientProfile.findUniqueOrThrow({ where: { id: client.id } })
    expect(erased.firstName).toBe('Erased')
    expect(erased.email).toBeNull()
    expect(erased.phone).toBeNull()
    expect(erased.status).toBe('ERASED')

    // The invoice survives, because the salon has to account for it.
    expect(await unsafeDb.invoice.count({ where: { salonId: S } })).toBe(1)
    expect(await unsafeDb.appointment.count({ where: { salonId: S } })).toBe(1)
  })

  it('erasure deletes photographs entirely', async () => {
    const client = await makeClient()
    await unsafeDb.photoAsset.create({
      data: {
        salonId: S,
        clientProfileId: client.id,
        storageKey: 'k/1',
        mimeType: 'image/jpeg',
      },
    })

    const result = await eraseClient({
      salonId: S,
      clientProfileId: client.id,
      requestedByUserId: 'cm_user',
      reason: 'Erasure request.',
    })

    expect(result.photosDeleted).toBe(1)
    expect(await unsafeDb.photoAsset.count({ where: { salonId: S } })).toBe(0)
  })

  it('erasure is audited with a reason', async () => {
    const client = await makeClient()
    await eraseClient({
      salonId: S,
      clientProfileId: client.id,
      requestedByUserId: 'cm_user',
      reason: 'Written request, ticket 4821.',
    })

    const audit = await unsafeDb.auditLog.findFirst({
      where: { salonId: S, action: 'client.erase' },
    })
    expect(audit?.reason).toContain('4821')
  })
})
