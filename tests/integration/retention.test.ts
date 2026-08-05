import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { advanceAppointment } from '@/server/services/appointment-lifecycle'
import {
  aftercareFor,
  attachmentRate,
  firstTimerInterventions,
  recordAftercare,
} from '@/server/services/retention'
import {
  checkInByToken,
  mintCheckIn,
  resolveCheckIn,
  respondToCheckIn,
  unhappyCheckIns,
} from '@/server/services/check-in'
import { backbarSummary, costOfService, recordUsage } from '@/server/services/backbar'

/**
 * Keeping the clients a salon already has.
 *
 * Two of the things checked here were live defects rather than missing
 * features: a visit counter that went up twice for every appointment at a
 * salon that used both finish buttons, and a `NotificationTrigger` with
 * finished copy that nothing had ever created a row for.
 */

const S = 'rt_salon'
const TZ = 'America/New_York'
const NOW = new Date('2026-06-01T15:00:00Z')
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'rt-' } } })
  // Outbox is a global model with no FK to Salon, so deleting the salon does
  // not take its events — and every test in this file would otherwise see the
  // ones the test before it emitted.
  await unsafeDb.outbox.deleteMany({ where: { salonId: S } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'rt-salon',
      name: 'Retention Test Salon',
      defaultTimezone: TZ,
      settings: { create: {} },
      locations: { create: { id: 'rt_loc', name: 'Main', timezone: TZ } },
      serviceCategories: { create: { id: 'rt_cat', name: 'Hair', slug: 'hair' } },
    },
  })

  await unsafeDb.user.create({ data: { id: 'rt_user', email: 'rt-sty@example.com' } })
  await unsafeDb.membership.create({
    data: { id: 'rt_mem', salonId: S, userId: 'rt_user', role: 'STYLIST' },
  })
  await unsafeDb.stylistProfile.create({
    data: { id: 'rt_sty', salonId: S, membershipId: 'rt_mem', displayName: 'Wren' },
  })
  await unsafeDb.retailProduct.create({
    data: { id: 'rt_prod', salonId: S, sku: 'BOND-1', name: 'Bond builder', priceCents: 2_800 },
  })
}

async function makeClient(id: string, extra: Record<string, unknown> = {}) {
  return unsafeDb.clientProfile.create({
    data: { id, salonId: S, firstName: 'Ada', lastName: id, ...extra },
  })
}

async function makeAppointment(
  id: string,
  clientProfileId: string,
  startsAt: Date,
  status = 'COMPLETED',
) {
  return unsafeDb.appointment.create({
    data: {
      id,
      salonId: S,
      locationId: 'rt_loc',
      clientProfileId,
      primaryStylistId: 'rt_sty',
      status: status as never,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      estimatedDurationMin: 60,
    },
  })
}

beforeEach(seed)
afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'rt-' } } })
  await unsafeDb.outbox.deleteMany({ where: { salonId: S } })
})

describe('one visit, however many taps it took', () => {
  it('does not count an appointment twice when the desk uses both buttons', async () => {
    /*
     * "Finished" then "Check out" is the desk's normal sequence and both land
     * in the same place. An unguarded increment made this counter roughly
     * double at salons that used both and correct at salons that skipped
     * straight to checkout — wrong AND inconsistent between salons, which is
     * worse. `completedVisits === 0` is how nine places ask "is this new".
     */
    await makeClient('rt_c1')
    await makeAppointment('rt_a1', 'rt_c1', day(1), 'IN_CHAIR')

    await advanceAppointment({ salonId: S, appointmentId: 'rt_a1', step: 'END_CHAIR' })
    await advanceAppointment({ salonId: S, appointmentId: 'rt_a1', step: 'CHECK_OUT' })

    const client = await unsafeDb.clientProfile.findUniqueOrThrow({ where: { id: 'rt_c1' } })
    expect(client.completedVisits).toBe(1)
  })

  it('still counts one when the desk skips straight to checkout', async () => {
    await makeClient('rt_c2')
    await makeAppointment('rt_a2', 'rt_c2', day(1), 'IN_CHAIR')

    await advanceAppointment({ salonId: S, appointmentId: 'rt_a2', step: 'CHECK_OUT' })

    const client = await unsafeDb.clientProfile.findUniqueOrThrow({ where: { id: 'rt_c2' } })
    expect(client.completedVisits).toBe(1)
  })

  it('sets the first visit once and never moves it', async () => {
    // It is what the whole first-timer cohort is measured from.
    await makeClient('rt_c3')
    await makeAppointment('rt_a3', 'rt_c3', day(60), 'IN_CHAIR')
    await makeAppointment('rt_a4', 'rt_c3', day(1), 'IN_CHAIR')

    await advanceAppointment({ salonId: S, appointmentId: 'rt_a3', step: 'CHECK_OUT' })
    const first = await unsafeDb.clientProfile.findUniqueOrThrow({ where: { id: 'rt_c3' } })

    await advanceAppointment({ salonId: S, appointmentId: 'rt_a4', step: 'CHECK_OUT' })
    const after = await unsafeDb.clientProfile.findUniqueOrThrow({ where: { id: 'rt_c3' } })

    expect(after.firstVisitAt?.toISOString()).toBe(first.firstVisitAt?.toISOString())
    expect(after.lastVisitAt?.getTime()).toBeGreaterThan(first.firstVisitAt!.getTime())
    expect(after.completedVisits).toBe(2)
  })
})

describe('asking how it is sitting', () => {
  it('emits once for an appointment, not once per tap', async () => {
    /*
     * APPOINTMENT_AFTER has had finished copy since the schema was written and
     * nothing ever created one. Asking the same client twice how their hair is
     * would be worse than never asking.
     */
    await makeClient('rt_c4')
    await makeAppointment('rt_a5', 'rt_c4', day(1), 'IN_CHAIR')

    await advanceAppointment({ salonId: S, appointmentId: 'rt_a5', step: 'END_CHAIR' })
    await advanceAppointment({ salonId: S, appointmentId: 'rt_a5', step: 'CHECK_OUT' })

    const emitted = await unsafeDb.outbox.findMany({
      where: { salonId: S, topic: 'appointment.completed' },
    })
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.payloadJson).toMatchObject({
      appointmentId: 'rt_a5',
      clientProfileId: 'rt_c4',
    })
  })
})

describe('first-timers who have not been back', () => {
  it('lists somebody seen once, a while ago, with nothing booked', async () => {
    await makeClient('rt_c5', { completedVisits: 1, firstVisitAt: day(45) })
    await makeAppointment('rt_a6', 'rt_c5', day(45))

    const risk = await firstTimerInterventions(S, NOW)
    expect(risk.map((r) => r.clientProfileId)).toEqual(['rt_c5'])
    expect(risk[0]).toMatchObject({ daysSince: 45, stylistName: 'Wren' })
  })

  it('leaves alone somebody with an appointment in the diary', async () => {
    /*
     * Anything on the books counts as coming back. Putting a client with a
     * booking next Thursday on a "we are losing them" list is how a front desk
     * learns to ignore the list.
     */
    await makeClient('rt_c6', { completedVisits: 1, firstVisitAt: day(45) })
    await makeAppointment('rt_a7', 'rt_c6', day(45))
    await makeAppointment('rt_a8', 'rt_c6', new Date(NOW.getTime() + 86_400_000), 'BOOKED')

    expect(await firstTimerInterventions(S, NOW)).toEqual([])
  })

  it('leaves alone somebody who was in last week', async () => {
    await makeClient('rt_c7', { completedVisits: 1, firstVisitAt: day(6) })
    await makeAppointment('rt_a9', 'rt_c7', day(6))

    expect(await firstTimerInterventions(S, NOW)).toEqual([])
  })
})

describe('aftercare', () => {
  it('lands on the client’s own timeline, not just the appointment', async () => {
    /*
     * In six weeks nobody opens an appointment from April. They open their
     * hair — and `TimelineKind.HOME_CARE` has been styled and labelled "At
     * home" this whole time with nothing to draw.
     */
    await makeClient('rt_c8')
    await makeAppointment('rt_a10', 'rt_c8', day(1))

    await recordAftercare({
      salonId: S,
      appointmentId: 'rt_a10',
      advice: 'Leave it 48 hours. Cool water on the rinse.',
      products: [{ retailProductId: 'rt_prod', reason: 'The ends are porous after that lift.' }],
      byUserId: 'rt_user',
    })

    const event = await unsafeDb.hairHistoryEvent.findFirstOrThrow({
      where: { salonId: S, clientProfileId: 'rt_c8' },
    })
    expect(event.type).toBe('AT_HOME_TREATMENT')
    expect(event.isClientVisible).toBe(true)
    expect(event.summary).toContain('Cool water')
  })

  it('keeps the reason, which is what makes it advice', async () => {
    await makeClient('rt_c9')
    await makeAppointment('rt_a11', 'rt_c9', day(1))

    await recordAftercare({
      salonId: S,
      appointmentId: 'rt_a11',
      advice: '',
      products: [{ retailProductId: 'rt_prod', reason: 'The ends are porous after that lift.' }],
      byUserId: 'rt_user',
    })

    const back = await aftercareFor(S, 'rt_a11')
    expect(back.recommendations).toHaveLength(1)
    expect(back.recommendations[0]?.reason).toBe('The ends are porous after that lift.')
    expect(back.recommendations[0]?.status).toBe('RECOMMENDED')
  })

  it('refuses to save nothing at all', async () => {
    await makeClient('rt_c10')
    await makeAppointment('rt_a12', 'rt_c10', day(1))

    await expect(
      recordAftercare({
        salonId: S,
        appointmentId: 'rt_a12',
        advice: '   ',
        products: [],
        byUserId: null,
      }),
    ).rejects.toThrow(/nothing to save/i)
  })

  it('measures what was suggested against what was bought', async () => {
    await makeClient('rt_c11')
    await makeAppointment('rt_a13', 'rt_c11', day(1))
    await recordAftercare({
      salonId: S,
      appointmentId: 'rt_a13',
      advice: 'Bond builder once a week.',
      products: [{ retailProductId: 'rt_prod', reason: 'Porous ends.' }],
      byUserId: null,
    })

    /*
     * Against the real clock, not the fixture's: `createdAt` on a
     * recommendation is now(), and a range anchored on a date in the test's own
     * past would exclude the row it just wrote.
     */
    const range = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) }
    expect(await attachmentRate(S, range)).toMatchObject({ recommended: 1, purchased: 0, rate: 0 })

    await unsafeDb.productRecommendation.updateMany({
      where: { salonId: S },
      data: { status: 'PURCHASED' },
    })
    expect(await attachmentRate(S, range)).toMatchObject({ recommended: 1, purchased: 1, rate: 1 })
  })

  it('says nothing rather than zero when nothing was suggested', async () => {
    const range = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) }
    expect((await attachmentRate(S, range)).rate).toBeNull()
  })
})

describe('the 72-hour check-in', () => {
  it('mints one link per appointment, however many times the dispatch retries', async () => {
    /*
     * Two links to one visit means the client's answer depends on which text
     * they happened to open. The token is an HMAC of the appointment id rather
     * than a random string, so a retried send rebuilds the same link without
     * the secret ever living in a row.
     */
    await makeClient('rt_c12')
    await makeAppointment('rt_a14', 'rt_c12', day(3))

    const first = await mintCheckIn(S, 'rt_a14')
    const again = await mintCheckIn(S, 'rt_a14')

    expect(first?.token).toBe(again?.token)
    expect(await unsafeDb.postVisitCheckIn.count({ where: { salonId: S } })).toBe(1)
  })

  it('never stores the token itself', async () => {
    // A leaked database must not be a set of working links into clients'
    // feedback.
    await makeClient('rt_c13')
    await makeAppointment('rt_a15', 'rt_c13', day(3))
    const minted = await mintCheckIn(S, 'rt_a15')

    const row = await unsafeDb.postVisitCheckIn.findFirstOrThrow({ where: { salonId: S } })
    expect(row.tokenHash).not.toBe(minted?.token)
    expect(JSON.stringify(row)).not.toContain(minted!.token)
  })

  it('reads without consuming, because link previewers exist', async () => {
    /*
     * Message-app unfurlers and email security scanners GET any URL they see.
     * A check-in that answered itself on page load would be filled in by a
     * robot before the client ever opened it.
     */
    await makeClient('rt_c14')
    await makeAppointment('rt_a16', 'rt_c14', day(3))
    const minted = await mintCheckIn(S, 'rt_a16')

    const view = await checkInByToken(minted!.token)
    expect(view).toMatchObject({ salonId: S, clientFirstName: 'Ada', respondedAt: null })

    const row = await unsafeDb.postVisitCheckIn.findFirstOrThrow({ where: { salonId: S } })
    expect(row.respondedAt).toBeNull()
  })

  it('records the answer once and treats a second tap as a no-op', async () => {
    await makeClient('rt_c15')
    await makeAppointment('rt_a17', 'rt_c15', day(3))
    const minted = await mintCheckIn(S, 'rt_a17')

    expect(
      await respondToCheckIn({ salonId: S, token: minted!.token, sentiment: 'NOT_RIGHT', note: 'Brassy.' }),
    ).toEqual({ recorded: true })

    // Somebody double-tapping on a phone sees a thank-you, not an error — and
    // does not silently rewrite what the salon has already acted on.
    expect(
      await respondToCheckIn({ salonId: S, token: minted!.token, sentiment: 'DELIGHTED', note: null }),
    ).toEqual({ recorded: false })

    const row = await unsafeDb.postVisitCheckIn.findFirstOrThrow({ where: { salonId: S } })
    expect(row.sentiment).toBe('NOT_RIGHT')
    expect(row.note).toBe('Brassy.')
  })

  it('refuses a token replayed against another salon', async () => {
    /*
     * `PublicContext` carries no scoped Prisma client, and the slug in a public
     * URL is whatever the caller typed. The salon has to be asserted by hand.
     */
    await makeClient('rt_c16')
    await makeAppointment('rt_a18', 'rt_c16', day(3))
    const minted = await mintCheckIn(S, 'rt_a18')

    await expect(
      respondToCheckIn({
        salonId: 'some-other-salon',
        token: minted!.token,
        sentiment: 'FINE',
        note: null,
      }),
    ).rejects.toThrow(/not one of ours/)
  })

  it('refuses a link that has aged out', async () => {
    await makeClient('rt_c17')
    await makeAppointment('rt_a19', 'rt_c17', day(60))
    const minted = await mintCheckIn(S, 'rt_a19', new Date(Date.now() - 60 * 86_400_000))

    await expect(
      respondToCheckIn({ salonId: S, token: minted!.token, sentiment: 'FINE', note: null }),
    ).rejects.toThrow(/expired/)
  })

  it('puts only the unhappy, unresolved ones in front of the desk', async () => {
    // A list that also held the happy ones is a feed to scroll rather than a
    // queue to clear, and the value of a 72-hour window is that somebody acts.
    await makeClient('rt_c18')
    await makeClient('rt_c19')
    await makeAppointment('rt_a20', 'rt_c18', day(3))
    await makeAppointment('rt_a21', 'rt_c19', day(3))

    const sad = await mintCheckIn(S, 'rt_a20')
    const happy = await mintCheckIn(S, 'rt_a21')
    await respondToCheckIn({ salonId: S, token: sad!.token, sentiment: 'NOT_RIGHT', note: 'Brassy.' })
    await respondToCheckIn({ salonId: S, token: happy!.token, sentiment: 'DELIGHTED', note: null })

    const queue = await unhappyCheckIns(S)
    expect(queue).toHaveLength(1)
    expect(queue[0]?.clientProfile.id).toBe('rt_c18')

    await resolveCheckIn(S, queue[0]!.id, 'rt_user')
    expect(await unhappyCheckIns(S)).toEqual([])
  })
})

describe('what the colour cost', () => {
  async function mixOn(appointmentId: string, clientProfileId: string) {
    const formula = await unsafeDb.formula.create({
      data: {
        salonId: S,
        clientProfileId,
        appointmentId,
        stylistProfileId: 'rt_sty',
        purpose: 'GLOBAL_COLOR',
        components: {
          create: [
            {
              salonId: S,
              sequence: 0,
              productName: 'Shade 7.1',
              parts: 1,
              retailProductId: 'rt_colour',
            },
            {
              salonId: S,
              sequence: 1,
              productName: 'Developer 20vol',
              parts: 1.5,
              retailProductId: 'rt_dev',
            },
          ],
        },
      },
      select: { id: true },
    })
    return formula.id
  }

  beforeEach(async () => {
    // £12.00 for 60g is 20c a gram; £6.00 for 1000ml is 0.6c a gram.
    await unsafeDb.retailProduct.createMany({
      data: [
        {
          id: 'rt_colour',
          salonId: S,
          sku: 'COL-71',
          name: 'Shade 7.1',
          priceCents: 0,
          costCents: 1_200,
          backbarGramsPerUnit: 60,
          isBackbar: true,
        },
        {
          id: 'rt_dev',
          salonId: S,
          sku: 'DEV-20',
          name: 'Developer 20vol',
          priceCents: 0,
          costCents: 600,
          backbarGramsPerUnit: 1_000,
          isBackbar: true,
        },
      ],
    })
  })

  it('costs the bowl from the formula the stylist already wrote', async () => {
    /*
     * Reading the formula rather than asking for the mix again: anything that
     * makes a stylist type the same thing twice gets typed once, and the second
     * copy is the one with the money in it.
     */
    await makeClient('rt_c20')
    await makeAppointment('rt_a22', 'rt_c20', day(1))
    const formulaId = await mixOn('rt_a22', 'rt_c20')

    // 60g of colour at 20c and 90g of developer at 0.6c.
    const { totalCents } = await recordUsage({
      salonId: S,
      appointmentId: 'rt_a22',
      formulaId,
      anchorGrams: 60,
      wasteGrams: 0,
    })
    expect(totalCents).toBe(1_200 + 54)

    const cost = await costOfService(S, 'rt_a22')
    expect(cost?.lines.map((l) => l.grams)).toEqual([60, 90])
    expect(cost?.incomplete).toBe(false)
  })

  it('keeps waste separate, because it is the half anyone can change', async () => {
    await makeClient('rt_c21')
    await makeAppointment('rt_a23', 'rt_c21', day(1))
    const formulaId = await mixOn('rt_a23', 'rt_c21')

    await recordUsage({
      salonId: S,
      appointmentId: 'rt_a23',
      formulaId,
      anchorGrams: 60,
      wasteGrams: 50,
    })

    const cost = await costOfService(S, 'rt_a23')
    expect(cost!.wasteCents).toBeGreaterThan(0)
    expect(cost!.wasteCents).toBeLessThan(cost!.totalCents)
  })

  it('replaces the record rather than logging a second bowl', async () => {
    // A stylist correcting 60g to 90g is fixing a mistake.
    await makeClient('rt_c22')
    await makeAppointment('rt_a24', 'rt_c22', day(1))
    const formulaId = await mixOn('rt_a24', 'rt_c22')

    await recordUsage({ salonId: S, appointmentId: 'rt_a24', formulaId, anchorGrams: 60, wasteGrams: 0 })
    await recordUsage({ salonId: S, appointmentId: 'rt_a24', formulaId, anchorGrams: 90, wasteGrams: 0 })

    const cost = await costOfService(S, 'rt_a24')
    expect(cost?.lines).toHaveLength(2)
    expect(cost?.lines[0]?.grams).toBe(90)
  })

  it('says so when a product has no costed tube size behind it', async () => {
    /*
     * A margin quietly computed as if a product were free is the number an
     * owner would price against. Better to show the gap.
     */
    await unsafeDb.retailProduct.update({
      where: { id: 'rt_dev' },
      data: { backbarGramsPerUnit: null },
    })
    await makeClient('rt_c23')
    await makeAppointment('rt_a25', 'rt_c23', day(1))
    const formulaId = await mixOn('rt_a25', 'rt_c23')

    await recordUsage({ salonId: S, appointmentId: 'rt_a25', formulaId, anchorGrams: 60, wasteGrams: 0 })

    const cost = await costOfService(S, 'rt_a25')
    expect(cost?.incomplete).toBe(true)
    // The half it does know is still reported.
    expect(cost?.totalCents).toBe(1_200)
  })

  it('refuses to cost a bowl nobody wrote down', async () => {
    await makeClient('rt_c24')
    await makeAppointment('rt_a26', 'rt_c24', day(1))

    await expect(
      recordUsage({ salonId: S, appointmentId: 'rt_a26', formulaId: null, anchorGrams: 60, wasteGrams: 0 }),
    ).rejects.toThrow(/formula/i)
  })

  it('adds up a period, with waste beside the spend', async () => {
    await makeClient('rt_c25')
    await makeAppointment('rt_a27', 'rt_c25', day(1))
    const formulaId = await mixOn('rt_a27', 'rt_c25')
    await recordUsage({ salonId: S, appointmentId: 'rt_a27', formulaId, anchorGrams: 60, wasteGrams: 30 })

    const summary = await backbarSummary(S, {
      from: new Date(Date.now() - 86_400_000),
      to: new Date(Date.now() + 86_400_000),
    })
    expect(summary.appointments).toBe(1)
    expect(summary.spentCents).toBe(1_254)
    expect(summary.wasteCents).toBeGreaterThan(0)
  })
})
