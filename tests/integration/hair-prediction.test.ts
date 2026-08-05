import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { predictionFor, updateHairProfile } from '@/server/services/hair-prediction'
import { saveFormula } from '@/server/services/formulas'

/**
 * When this client needs to be back.
 *
 * The feature was dropped from Phase 8 after mapping found it would demo
 * perfectly on the seeded salon and render an em dash for every real one:
 * nothing wrote `HairProfile`, `SALON_COLOR` never entered the history array,
 * and `Formula.createdAt` was when the mix was typed up rather than when the
 * colour went on. These tests are about those four things, not about the
 * arithmetic — the arithmetic is pinned in tests/unit/hair/fade.test.ts.
 */

const S = 'hp_salon'
const TZ = 'Europe/London'
const NOW = new Date('2026-06-01T12:00:00Z')

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'hp-' } } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'hp-salon',
      name: 'Prediction Test Salon',
      defaultTimezone: TZ,
      settings: { create: {} },
      locations: { create: { id: 'hp_loc', name: 'Main', timezone: TZ } },
      clientProfiles: { create: { id: 'hp_cli', firstName: 'Ada', lastName: 'Rivera' } },
    },
  })

  await unsafeDb.user.create({ data: { id: 'hp_user', email: 'hp-sty@example.com' } })
  await unsafeDb.membership.create({
    data: { id: 'hp_mem', salonId: S, userId: 'hp_user', role: 'STYLIST' },
  })
  await unsafeDb.stylistProfile.create({
    data: { id: 'hp_sty', salonId: S, membershipId: 'hp_mem', displayName: 'Wren' },
  })
  await unsafeDb.retailProduct.create({
    data: { id: 'hp_prod', salonId: S, sku: 'COL-71', name: 'Shade 7.1', priceCents: 0 },
  })
}

async function appointment(id: string, startsAt: string, status = 'COMPLETED') {
  await unsafeDb.appointment.create({
    data: {
      id,
      salonId: S,
      locationId: 'hp_loc',
      clientProfileId: 'hp_cli',
      primaryStylistId: 'hp_sty',
      status: status as never,
      startsAt: new Date(startsAt),
      endsAt: new Date(new Date(startsAt).getTime() + 3_600_000),
      estimatedDurationMin: 60,
    },
  })
}

beforeEach(seed)
afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'hp-' } } })
})

describe('before anybody has written anything down', () => {
  it('says it cannot say, and says what it would need', async () => {
    /*
     * The failure the feature was dropped over: on a real salon every input is
     * empty, and a predictor that filled the gaps with averages would render a
     * confident date for a client nobody has ever measured.
     */
    const p = await predictionFor(S, 'hp_cli', NOW)
    expect(p.dueAt).toBeNull()
    expect(p.confidence).toBe('NONE')
    expect(p.missing).toContain('when their colour was last done')
  })
})

describe('writing the hair down', () => {
  it('creates a profile for a client who has never had a consultation', async () => {
    /*
     * `HairProfile` had one writer in the whole application and it was a
     * compliance field. A walk-in the desk created has no profile at all, and
     * the desk should not have to start a consultation to record that somebody
     * washes their hair every day.
     */
    await updateHairProfile(S, 'hp_cli', { naturalLevel: 6, washesPerWeek: 7 })

    const profile = await unsafeDb.hairProfile.findUniqueOrThrow({
      where: { clientProfileId: 'hp_cli' },
    })
    expect(profile.naturalLevel).toBe(6)
    expect(profile.washesPerWeek).toBe(7)
  })

  it('leaves alone what the form did not ask about', async () => {
    await updateHairProfile(S, 'hp_cli', { naturalLevel: 6, greyPercent: 40 })
    await updateHairProfile(S, 'hp_cli', { washesPerWeek: 5 })

    const profile = await unsafeDb.hairProfile.findUniqueOrThrow({
      where: { clientProfileId: 'hp_cli' },
    })
    expect(profile.greyPercent).toBe(40)
    expect(profile.washesPerWeek).toBe(5)
  })

  it('refuses a client who is not this salon’s', async () => {
    await expect(
      updateHairProfile(S, 'somebody-elses-client', { naturalLevel: 6 }),
    ).rejects.toThrow(/not here/)
  })
})

describe('a formula, which nothing in the product could write', () => {
  it('dates the colour from the appointment, not from when it was typed', async () => {
    /*
     * A formula written up at the end of the day — or three days later when
     * somebody remembers — is still a colour that went on at the appointment.
     * `createdAt` is the clock everything asking "how grown out is this" reads.
     */
    await appointment('hp_a1', '2026-05-01T10:00:00Z')
    await saveFormula({
      salonId: S,
      appointmentId: 'hp_a1',
      stylistProfileId: 'hp_sty',
      purpose: 'GLOBAL_COLOR',
      developerVolume: 20,
      components: [{ productName: 'Shade 7.1', parts: 1, retailProductId: 'hp_prod' }],
    })

    const formula = await unsafeDb.formula.findFirstOrThrow({ where: { salonId: S } })
    expect(formula.createdAt.toISOString()).toBe('2026-05-01T10:00:00.000Z')
  })

  it('tells the hair record a colour happened, so nobody types the date twice', async () => {
    // The profile's dates are what the history array reads, and the history
    // array is what had nothing in it.
    await appointment('hp_a2', '2026-05-01T10:00:00Z')
    await saveFormula({
      salonId: S,
      appointmentId: 'hp_a2',
      stylistProfileId: 'hp_sty',
      purpose: 'GLOBAL_COLOR',
      developerVolume: 20,
      components: [{ productName: 'Shade 7.1', parts: 1 }],
    })

    const profile = await unsafeDb.hairProfile.findUniqueOrThrow({
      where: { clientProfileId: 'hp_cli' },
    })
    expect(profile.hasSalonColor).toBe(true)
    expect(profile.salonColorLastAt?.toISOString().slice(0, 10)).toBe('2026-05-01')
  })

  it('records a lightener as bleach as well as colour', async () => {
    await appointment('hp_a3', '2026-05-01T10:00:00Z')
    await saveFormula({
      salonId: S,
      appointmentId: 'hp_a3',
      stylistProfileId: 'hp_sty',
      purpose: 'LIGHTENER',
      components: [{ productName: 'Bleach', parts: 1 }],
    })

    const profile = await unsafeDb.hairProfile.findUniqueOrThrow({
      where: { clientProfileId: 'hp_cli' },
    })
    expect(profile.hasBleach).toBe(true)
    expect(profile.bleachLastAt).not.toBeNull()
  })

  it('replaces the formula rather than leaving two on one appointment', async () => {
    await appointment('hp_a4', '2026-05-01T10:00:00Z')
    const input = {
      salonId: S,
      appointmentId: 'hp_a4',
      stylistProfileId: 'hp_sty',
      purpose: 'GLOBAL_COLOR',
      components: [{ productName: 'Shade 7.1', parts: 1 }],
    }
    await saveFormula(input)
    await saveFormula({ ...input, developerVolume: 30 })

    expect(await unsafeDb.formula.count({ where: { salonId: S } })).toBe(1)
  })

  it('refuses a product belonging to another salon', async () => {
    // `FormulaComponent.retailProductId` is a bare string with no foreign key,
    // and it is the id the backbar costing then prices against.
    await appointment('hp_a5', '2026-05-01T10:00:00Z')
    await expect(
      saveFormula({
        salonId: S,
        appointmentId: 'hp_a5',
        stylistProfileId: 'hp_sty',
        purpose: 'GLOSS',
        components: [{ productName: 'Theirs', retailProductId: 'not-ours' }],
      }),
    ).rejects.toThrow(/not one of yours/)
  })
})

describe('once it has something to work from', () => {
  async function colouredOn(purpose: string, developerVolume: number | null, at: string) {
    await appointment('hp_ax', at)
    await saveFormula({
      salonId: S,
      appointmentId: 'hp_ax',
      stylistProfileId: 'hp_sty',
      purpose,
      developerVolume,
      components: [{ productName: 'Shade', parts: 1 }],
    })
  }

  it('predicts from the formula, and says how sure it is', async () => {
    await colouredOn('GLOBAL_COLOR', 20, '2026-05-01T10:00:00Z')

    const rough = await predictionFor(S, 'hp_cli', NOW)
    expect(rough.dueAt).not.toBeNull()
    expect(rough.confidence).toBe('ROUGH')
    expect(rough.basis.growthIsAverage).toBe(true)

    await updateHairProfile(S, 'hp_cli', {
      naturalLevel: 6,
      currentLevelRoots: 7,
      washesPerWeek: 4,
      growthCmPerMonth: 1.3,
    })

    const good = await predictionFor(S, 'hp_cli', NOW)
    expect(good.confidence).toBe('GOOD')
    expect(good.basis.growthIsAverage).toBe(false)
  })

  it('has a toner due back long before a tint', async () => {
    await colouredOn('TONER', null, '2026-05-01T10:00:00Z')
    const toner = await predictionFor(S, 'hp_cli', NOW)

    await unsafeDb.formula.deleteMany({ where: { salonId: S } })
    await unsafeDb.appointment.deleteMany({ where: { salonId: S } })
    await colouredOn('GLOBAL_COLOR', 20, '2026-05-01T10:00:00Z')
    const tint = await predictionFor(S, 'hp_cli', NOW)

    expect(toner.intervalWeeks!).toBeLessThan(tint.intervalWeeks!)
  })

  it('ignores a colour on an appointment the client never attended', async () => {
    /*
     * A booked-and-cancelled visit is not a colour that happened, and starting
     * the clock on it would tell the client their roots are showing from a
     * service they did not have.
     */
    await appointment('hp_a6', '2026-05-01T10:00:00Z', 'CANCELLED')
    await saveFormula({
      salonId: S,
      appointmentId: 'hp_a6',
      stylistProfileId: 'hp_sty',
      purpose: 'GLOBAL_COLOR',
      developerVolume: 20,
      components: [{ productName: 'Shade', parts: 1 }],
    })

    /*
     * The profile date is still written — the stylist recorded a mix — but it
     * carries no kind, so the prediction falls back to assuming permanent and
     * says its confidence is only rough.
     */
    const p = await predictionFor(S, 'hp_cli', NOW)
    expect(p.basis.kind).toBe('PERMANENT')
    expect(p.confidence).not.toBe('GOOD')
  })
})
