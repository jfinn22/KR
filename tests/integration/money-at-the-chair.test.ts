import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import {
  buildInvoice,
  findGiftCard,
  giftCardBalance,
  loadInvoice,
  priceInvoice,
  redeemGiftCard,
  resolveDiscount,
  takePayment,
} from '@/server/services/commerce'

/**
 * What the till can do to a bill, and what it cannot.
 *
 * Four capabilities land together because they are one mechanism: a line added
 * changes the subtotal, the subtotal is what a discount cap is measured
 * against, a gift card is sold as a line, and a price edited downward is a
 * discount whether or not anyone calls it one. Testing them apart would test
 * four things that never happen apart.
 */

const S = 'mc_salon'

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'mc-salon',
      name: 'Till Test Salon',
      currency: 'USD',
      settings: { create: { depositCapCents: 50_000 } },
      locations: { create: { id: 'mc_loc', name: 'Main' } },
      serviceCategories: { create: { id: 'mc_cat', name: 'Colour', slug: 'colour' } },
    },
  })

  await unsafeDb.user.create({ data: { id: 'mc_user', email: 'mc-owner@example.com' } })
  await unsafeDb.membership.create({
    data: { id: 'mc_mem', salonId: S, userId: 'mc_user', role: 'OWNER' },
  })
  await unsafeDb.stylistProfile.create({
    data: { id: 'mc_sty', salonId: S, membershipId: 'mc_mem', displayName: 'Rowan' },
  })
  await unsafeDb.service.create({
    data: {
      id: 'mc_svc',
      salonId: S,
      categoryId: 'mc_cat',
      name: 'Full balayage',
      slug: 'balayage',
      basePriceCents: 20_000,
      baseComplexity: 15,
      isChemical: true,
    },
  })

  await unsafeDb.discountReason.createMany({
    data: [
      { id: 'mc_pct', salonId: S, label: 'Staff', kind: 'PERCENT', value: 2_000 },
      { id: 'mc_fix', salonId: S, label: 'First visit', kind: 'FIXED', value: 1_000 },
      { id: 'mc_cap', salonId: S, label: 'Capped', kind: 'PERCENT', value: 5_000, maxCents: 3_000 },
      { id: 'mc_open', salonId: S, label: 'Put right', kind: 'OPEN', value: 0 },
      {
        id: 'mc_off',
        salonId: S,
        label: 'Retired',
        kind: 'PERCENT',
        value: 9_000,
        isActive: false,
      },
    ],
  })
}

beforeAll(seed, 90_000)

beforeEach(async () => {
  await unsafeDb.giftCardEntry.deleteMany({ where: { salonId: S } })
  await unsafeDb.giftCard.deleteMany({ where: { salonId: S } })
  await unsafeDb.payment.deleteMany({ where: { salonId: S } })
  await unsafeDb.invoice.deleteMany({ where: { salonId: S } })
  await unsafeDb.appointment.deleteMany({ where: { salonId: S } })
  await unsafeDb.clientProfile.deleteMany({ where: { salonId: S } })
})

afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'mc-' } } })
  await unsafeDb.$disconnect()
})

async function makeAppointment(totalCents = 20_000) {
  const client = await unsafeDb.clientProfile.create({
    data: { salonId: S, firstName: 'Ada', lastName: 'Rivera' },
    select: { id: true },
  })
  const appointment = await unsafeDb.appointment.create({
    data: {
      salonId: S,
      locationId: 'mc_loc',
      clientProfileId: client.id,
      primaryStylistId: 'mc_sty',
      status: 'COMPLETED',
      startsAt: new Date('2026-08-01T14:00:00Z'),
      endsAt: new Date('2026-08-01T17:00:00Z'),
      estimatedDurationMin: 180,
      estimatedTotalCents: totalCents,
      services: {
        create: {
          salonId: S,
          serviceId: 'mc_svc',
          stylistProfileId: 'mc_sty',
          sequence: 0,
          plannedDurationMin: 180,
          priceCents: totalCents,
        },
      },
    },
    include: { services: { select: { id: true } } },
  })
  return { appointment, serviceLineId: appointment.services[0]!.id }
}

describe('billing exactly what was agreed', () => {
  it('is still what happens when the till changes nothing', async () => {
    const { appointment } = await makeAppointment()
    const invoice = await buildInvoice({ salonId: S, appointmentId: appointment.id })

    expect(invoice.totalCents).toBe(20_000)
    const loaded = await loadInvoice(S, invoice.invoiceId)
    expect(loaded.lines).toHaveLength(1)
    // The agreed price is recorded even when nobody touched it, which is what
    // makes an untouched line distinguishable from an edited one later.
    expect(loaded.lines[0]!.agreedUnitPriceCents).toBe(20_000)
  })
})

describe('a line added at the till', () => {
  /*
   * `extraLines` was accepted by `buildInvoice` and hidden by the action's
   * schema — the capability existed and no screen could reach it.
   */
  it('is billed alongside the service', async () => {
    const { appointment, serviceLineId } = await makeAppointment()
    const invoice = await buildInvoice({
      salonId: S,
      appointmentId: appointment.id,
      lines: [
        {
          appointmentServiceId: serviceLineId,
          description: 'Full balayage',
          quantity: 1,
          unitPriceCents: 20_000,
        },
        { description: 'Bond builder', quantity: 1, unitPriceCents: 3_500, kind: 'RETAIL' },
      ],
    })

    expect(invoice.totalCents).toBe(23_500)
    const loaded = await loadInvoice(S, invoice.invoiceId)
    expect(loaded.lines).toHaveLength(2)
    expect(loaded.lines[1]!.kind).toBe('RETAIL')
    // Nobody agreed to it in advance, so there is nothing to compare against.
    expect(loaded.lines[1]!.agreedUnitPriceCents).toBeNull()
  })
})

describe('a price edited at the till', () => {
  it('charges the edited figure and records what was agreed', async () => {
    const { appointment, serviceLineId } = await makeAppointment()
    const invoice = await buildInvoice({
      salonId: S,
      appointmentId: appointment.id,
      lines: [
        {
          appointmentServiceId: serviceLineId,
          description: 'Full balayage',
          quantity: 1,
          unitPriceCents: 24_000,
        },
      ],
    })

    expect(invoice.totalCents).toBe(24_000)
    const loaded = await loadInvoice(S, invoice.invoiceId)
    expect(loaded.lines[0]!.unitPriceCents).toBe(24_000)
    expect(loaded.lines[0]!.agreedUnitPriceCents).toBe(20_000)
  })

  /*
   * The most obvious way around a discount cap: leave the discount field alone
   * and edit the line down instead. Counting the difference is what closes it,
   * and the count has to happen before anything is written.
   */
  it('counts a reduction toward the discount cap', async () => {
    const { appointment, serviceLineId } = await makeAppointment()
    const priced = await priceInvoice({
      salonId: S,
      appointmentId: appointment.id,
      lines: [
        {
          appointmentServiceId: serviceLineId,
          description: 'Full balayage',
          quantity: 1,
          unitPriceCents: 15_000,
        },
      ],
    })

    expect(priced.repricedDownCents).toBe(5_000)
    expect(priced.discountedCents).toBe(5_000)
  })

  it('counts an increase as nothing, because it is not a discount', async () => {
    const { appointment, serviceLineId } = await makeAppointment()
    const priced = await priceInvoice({
      salonId: S,
      appointmentId: appointment.id,
      lines: [
        {
          appointmentServiceId: serviceLineId,
          description: 'Full balayage',
          quantity: 1,
          unitPriceCents: 26_000,
        },
      ],
    })

    expect(priced.repricedDownCents).toBe(0)
  })
})

describe('the discount catalogue', () => {
  it('works the amount out from the reason, never from the caller', async () => {
    const pct = await resolveDiscount({
      salonId: S,
      discountReasonId: 'mc_pct',
      // A till that could post its own total could post any total. This is
      // ignored for anything but an OPEN reason.
      requestedCents: 19_999,
      subtotalCents: 20_000,
    })
    expect(pct.amountCents).toBe(4_000)
  })

  it('takes a fixed amount whatever the bill', async () => {
    const fixed = await resolveDiscount({
      salonId: S,
      discountReasonId: 'mc_fix',
      subtotalCents: 20_000,
    })
    expect(fixed.amountCents).toBe(1_000)
  })

  it('honours the owner’s ceiling on a reason', async () => {
    const capped = await resolveDiscount({
      salonId: S,
      discountReasonId: 'mc_cap',
      subtotalCents: 20_000,
    })
    // 50% of 200 is 100, but the owner said never more than 30.
    expect(capped.amountCents).toBe(3_000)
  })

  it('lets an open reason be named at the till', async () => {
    const open = await resolveDiscount({
      salonId: S,
      discountReasonId: 'mc_open',
      requestedCents: 2_500,
      subtotalCents: 20_000,
    })
    expect(open.amountCents).toBe(2_500)
  })

  // Retired rather than deleted, because bills already carry it.
  it('refuses a reason that has been retired', async () => {
    await expect(
      resolveDiscount({ salonId: S, discountReasonId: 'mc_off', subtotalCents: 20_000 }),
    ).rejects.toThrow(/not one of yours/)
  })

  it('refuses another salon’s reason', async () => {
    const other = await unsafeDb.salon.create({
      data: { id: 'mc_other', slug: 'mc-other', name: 'Other', settings: { create: {} } },
    })
    const theirs = await unsafeDb.discountReason.create({
      data: { salonId: other.id, label: 'Theirs', kind: 'PERCENT', value: 9_000 },
      select: { id: true },
    })

    try {
      await expect(
        resolveDiscount({ salonId: S, discountReasonId: theirs.id, subtotalCents: 20_000 }),
      ).rejects.toThrow(/not one of yours/)
    } finally {
      await unsafeDb.salon.deleteMany({ where: { id: 'mc_other' } })
    }
  })

  it('records the reason on the bill, so a month later somebody can ask why', async () => {
    const { appointment } = await makeAppointment()
    const invoice = await buildInvoice({
      salonId: S,
      appointmentId: appointment.id,
      orderDiscountCents: 4_000,
      discountReasonId: 'mc_pct',
      discountNote: 'Her colour had to be redone the following week.',
      discountApprovedByUserId: 'mc_user',
    })

    const row = await unsafeDb.invoice.findUniqueOrThrow({ where: { id: invoice.invoiceId } })
    expect(row.discountReasonId).toBe('mc_pct')
    expect(row.discountNote).toContain('redone')
    expect(row.discountApprovedByUserId).toBe('mc_user')
    expect(row.totalCents).toBe(16_000)
  })
})

describe('selling a gift card', () => {
  it('issues a real card inside the same transaction as the bill', async () => {
    const { appointment, serviceLineId } = await makeAppointment()
    const invoice = await buildInvoice({
      salonId: S,
      appointmentId: appointment.id,
      lines: [
        {
          appointmentServiceId: serviceLineId,
          description: 'Full balayage',
          quantity: 1,
          unitPriceCents: 20_000,
        },
        { description: 'Gift card', quantity: 1, unitPriceCents: 5_000, kind: 'GIFT_CARD' },
      ],
    })

    expect(invoice.totalCents).toBe(25_000)

    const cards = await unsafeDb.giftCard.findMany({ where: { salonId: S } })
    expect(cards).toHaveLength(1)
    expect(cards[0]!.initialCents).toBe(5_000)
    expect(cards[0]!.issuedOnInvoiceId).toBe(invoice.invoiceId)
    // A card can never exist without the sale that paid for it.
    expect(await giftCardBalance(S, cards[0]!.id)).toBe(5_000)
  })

  it('gives a code somebody can read down a phone', async () => {
    const { appointment, serviceLineId } = await makeAppointment()
    await buildInvoice({
      salonId: S,
      appointmentId: appointment.id,
      lines: [
        {
          appointmentServiceId: serviceLineId,
          description: 'Full balayage',
          quantity: 1,
          unitPriceCents: 20_000,
        },
        { description: 'Gift card', quantity: 1, unitPriceCents: 5_000, kind: 'GIFT_CARD' },
      ],
    })

    const card = await unsafeDb.giftCard.findFirstOrThrow({ where: { salonId: S } })
    // No O/0 or I/1 — a card is read aloud at a till, and a digit somebody
    // hears wrong is a card that does not exist.
    expect(card.code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/)
  })
})

describe('spending a gift card', () => {
  async function cardWorth(cents: number) {
    const card = await unsafeDb.giftCard.create({
      data: { salonId: S, code: 'ABCDE-12345', initialCents: cents },
      select: { id: true, code: true },
    })
    await unsafeDb.giftCardEntry.create({
      data: {
        salonId: S,
        giftCardId: card.id,
        amountCents: cents,
        kind: 'ISSUE',
        idempotencyKey: `seed_${card.id}`,
      },
    })
    return card
  }

  async function billFor(cents: number) {
    const { appointment } = await makeAppointment(cents)
    return buildInvoice({ salonId: S, appointmentId: appointment.id })
  }

  /*
   * A payment, not a negative line. The card was revenue when it was sold;
   * spending it is settlement. Recording it as a discount would count the same
   * money as revenue twice and leave the bill showing a subtotal the salon
   * never charged.
   */
  it('settles the bill as a payment, leaving the subtotal alone', async () => {
    const card = await cardWorth(5_000)
    const invoice = await billFor(20_000)

    const result = await redeemGiftCard({
      salonId: S,
      code: card.code,
      invoiceId: invoice.invoiceId,
      currency: 'USD',
      amountCents: 5_000,
      idempotencyKey: 'redeem-1',
    })

    expect(result.appliedCents).toBe(5_000)
    const loaded = await loadInvoice(S, invoice.invoiceId)
    expect(loaded.subtotalCents).toBe(20_000)
    expect(loaded.paidCents).toBe(5_000)
    expect(loaded.payments[0]!.method).toBe('GIFT_CARD')
  })

  it('never spends more than is on the card', async () => {
    const card = await cardWorth(2_000)
    const invoice = await billFor(20_000)

    const result = await redeemGiftCard({
      salonId: S,
      code: card.code,
      invoiceId: invoice.invoiceId,
      currency: 'USD',
      amountCents: 20_000,
      idempotencyKey: 'redeem-2',
    })
    expect(result.appliedCents).toBe(2_000)
    expect(result.remainingOnCardCents).toBe(0)
  })

  /*
   * And never more than is owed. Overpaying a bill from a card is how a
   * balance disappears into a salon's takings with nothing to show the client.
   */
  it('never spends more than the bill', async () => {
    const card = await cardWorth(50_000)
    const invoice = await billFor(8_000)

    const result = await redeemGiftCard({
      salonId: S,
      code: card.code,
      invoiceId: invoice.invoiceId,
      currency: 'USD',
      amountCents: 50_000,
      idempotencyKey: 'redeem-3',
    })
    expect(result.appliedCents).toBe(8_000)
    expect(result.remainingOnCardCents).toBe(42_000)
  })

  it('a double tap spends the card once', async () => {
    const card = await cardWorth(5_000)
    const invoice = await billFor(20_000)
    const args = {
      salonId: S,
      code: card.code,
      invoiceId: invoice.invoiceId,
      currency: 'USD',
      amountCents: 3_000,
      idempotencyKey: 'redeem-same',
    }

    await redeemGiftCard(args)
    await redeemGiftCard(args)

    expect(await giftCardBalance(S, card.id)).toBe(2_000)
    expect(await unsafeDb.giftCardEntry.count({ where: { salonId: S, kind: 'REDEEM' } })).toBe(1)
  })

  it('closes a card once it is spent out', async () => {
    const card = await cardWorth(5_000)
    const invoice = await billFor(20_000)

    await redeemGiftCard({
      salonId: S,
      code: card.code,
      invoiceId: invoice.invoiceId,
      currency: 'USD',
      amountCents: 5_000,
      idempotencyKey: 'redeem-4',
    })

    const row = await unsafeDb.giftCard.findUniqueOrThrow({ where: { id: card.id } })
    expect(row.status).toBe('REDEEMED')
  })

  it('refuses a card that is not this salon’s', async () => {
    const invoice = await billFor(20_000)
    await expect(
      redeemGiftCard({
        salonId: S,
        code: 'NOPE-NOPE1',
        invoiceId: invoice.invoiceId,
        currency: 'USD',
        amountCents: 1_000,
        idempotencyKey: 'redeem-5',
      }),
    ).rejects.toThrow(/No card with that code/)
  })

  it('refuses an expired card', async () => {
    const card = await unsafeDb.giftCard.create({
      data: {
        salonId: S,
        code: 'OLDCA-RD001',
        initialCents: 5_000,
        expiresAt: new Date('2020-01-01T00:00:00Z'),
      },
      select: { id: true, code: true },
    })
    await unsafeDb.giftCardEntry.create({
      data: {
        salonId: S,
        giftCardId: card.id,
        amountCents: 5_000,
        kind: 'ISSUE',
        idempotencyKey: `seed_${card.id}`,
      },
    })

    const invoice = await billFor(20_000)
    await expect(
      redeemGiftCard({
        salonId: S,
        code: card.code,
        invoiceId: invoice.invoiceId,
        currency: 'USD',
        amountCents: 1_000,
        idempotencyKey: 'redeem-6',
      }),
    ).rejects.toThrow(/expired/)
  })

  it('refuses to touch a bill that is already settled', async () => {
    const card = await cardWorth(5_000)
    const invoice = await billFor(8_000)
    await takePayment({
      salonId: S,
      invoiceId: invoice.invoiceId,
      amountCents: 8_000,
      method: 'CASH',
      currency: 'USD',
    })

    await expect(
      redeemGiftCard({
        salonId: S,
        code: card.code,
        invoiceId: invoice.invoiceId,
        currency: 'USD',
        amountCents: 1_000,
        idempotencyKey: 'redeem-7',
      }),
    ).rejects.toThrow(/already settled/)
  })

  it('finds a card by a code typed in lower case', async () => {
    const card = await cardWorth(5_000)
    const found = await findGiftCard(S, card.code.toLowerCase())
    expect(found?.balanceCents).toBe(5_000)
  })

  /*
   * The double SPEND, which is a different thing from the double tap.
   *
   * Two tills, two bills, two different idempotency keys, one card. Reading
   * the balance and then writing against it is two statements, and both
   * readers see the full amount — £50 of card settling £100 of bills. The
   * unique index cannot help here because the keys genuinely differ; only a
   * lock on the card row can.
   */
  it('cannot be spent twice at once from two tills', async () => {
    const card = await cardWorth(5_000)
    const first = await billFor(20_000)
    const second = await billFor(20_000)

    const results = await Promise.allSettled([
      redeemGiftCard({
        salonId: S,
        code: card.code,
        invoiceId: first.invoiceId,
        currency: 'USD',
        amountCents: 5_000,
        idempotencyKey: 'till-a',
      }),
      redeemGiftCard({
        salonId: S,
        code: card.code,
        invoiceId: second.invoiceId,
        currency: 'USD',
        amountCents: 5_000,
        idempotencyKey: 'till-b',
      }),
    ])

    const spent = results
      .filter((r) => r.status === 'fulfilled')
      .reduce(
        (sum, r) =>
          sum + (r as PromiseFulfilledResult<{ appliedCents: number }>).value.appliedCents,
        0,
      )

    // Whatever order they land in, the card is worth what it was worth.
    expect(spent).toBe(5_000)
    expect(await giftCardBalance(S, card.id)).toBe(0)
  })
})
