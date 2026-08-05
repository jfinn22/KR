import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { funnelReport, utilisationReport } from '@/server/services/analytics'

/**
 * Two numbers an owner reads and cannot check.
 *
 * Both were wrong in ways that look completely normal on screen: a fraction
 * whose numerator was not a subset of its denominator, and a denominator
 * counted in the wrong timezone. Neither errors, neither looks odd, and both
 * get acted on.
 */

const S = 'an_salon'
/** Deliberately west of Greenwich — the error only appears there. */
const TZ = 'America/Los_Angeles'
const range = { from: new Date('2026-05-01T00:00:00Z'), to: new Date('2026-06-01T00:00:00Z') }

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'an-' } } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'an-salon',
      name: 'Analytics Test Salon',
      defaultTimezone: TZ,
      settings: { create: {} },
      locations: { create: { id: 'an_loc', name: 'Main', timezone: TZ } },
      serviceCategories: { create: { id: 'an_cat', name: 'Hair', slug: 'hair' } },
      clientProfiles: { create: { id: 'an_cli', firstName: 'Ada', lastName: 'Rivera' } },
    },
  })

  await unsafeDb.user.create({ data: { id: 'an_user', email: 'an-sty@example.com' } })
  await unsafeDb.membership.create({
    data: { id: 'an_mem', salonId: S, userId: 'an_user', role: 'STYLIST' },
  })
  await unsafeDb.stylistProfile.create({
    data: { id: 'an_sty', salonId: S, membershipId: 'an_mem', displayName: 'Wren' },
  })

  await unsafeDb.consultationTemplate.create({
    data: { id: 'an_tpl', salonId: S, key: 'an-colour', name: 'Colour', version: 1 },
  })

  await unsafeDb.service.createMany({
    data: [
      {
        id: 'an_tint',
        salonId: S,
        categoryId: 'an_cat',
        name: 'Root tint',
        slug: 'root-tint',
        isChemical: true,
      },
      { id: 'an_cut', salonId: S, categoryId: 'an_cat', name: 'Dry cut', slug: 'dry-cut' },
    ],
  })
}

beforeEach(seed)
afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'an-' } } })
})

async function consultation(id: string, serviceIds: string[], withPhoto: boolean) {
  await unsafeDb.consultation.create({
    data: {
      id,
      salonId: S,
      clientProfileId: 'an_cli',
      templateId: 'an_tpl',
      templateVersion: 1,
      requestedServiceIds: serviceIds,
      createdAt: new Date('2026-05-15T12:00:00Z'),
    },
  })
  if (withPhoto) {
    const asset = await unsafeDb.photoAsset.create({
      data: {
        salonId: S,
        clientProfileId: 'an_cli',
        storageKey: `an/${id}.jpg`,
        mimeType: 'image/jpeg',
        bytes: 1_000,
        sha256: id.padEnd(64, '0'),
      },
    })
    await unsafeDb.consultationPhoto.create({
      data: { salonId: S, consultationId: id, photoAssetId: asset.id, view: 'FRONT' },
    })
  }
}

describe('the photo figure cannot exceed one', () => {
  it('counts only consultations that asked for chemical work', async () => {
    /*
     * The denominator used to be "requested any service at all", so a dry cut
     * landed in a photo requirement it never had — next to copy about chemical
     * consultations.
     */
    await consultation('an_c1', ['an_tint'], true)
    await consultation('an_c2', ['an_cut'], false)

    const { photos } = await funnelReport(S, range)
    expect(photos).toEqual({ needed: 1, provided: 1 })
  })

  it('will not let a consultation with photos and no chemical service inflate it', async () => {
    /*
     * The old numerator had no service filter at all, so this row raised
     * `provided` without ever raising `needed`. Repeat it enough and the screen
     * reads "12 of 9" — a fraction above one.
     */
    await consultation('an_c3', ['an_tint'], false)
    await consultation('an_c4', [], true)
    await consultation('an_c5', ['an_cut'], true)

    const { photos } = await funnelReport(S, range)
    expect(photos.needed).toBe(1)
    expect(photos.provided).toBe(0)
    expect(photos.provided).toBeLessThanOrEqual(photos.needed)
  })

  it('says nothing rather than dividing by nothing when the salon does no colour', async () => {
    await unsafeDb.service.update({ where: { id: 'an_tint' }, data: { isChemical: false } })
    await consultation('an_c6', ['an_cut'], true)

    expect((await funnelReport(S, range)).photos).toEqual({ needed: 0, provided: 0 })
  })
})

describe('a worked day is a day in the salon', () => {
  async function segment(id: string, startsAt: string, endsAt: string) {
    await unsafeDb.appointmentSegment.create({
      data: {
        id,
        salonId: S,
        locationId: 'an_loc',
        stylistProfileId: 'an_sty',
        kind: 'ACTIVE',
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
      },
    })
  }

  it('does not turn one late Tuesday into two days', async () => {
    /*
     * 4pm and 6pm Pacific on the same day are 23:00 and 01:00 UTC — different
     * UTC dates. Counted in UTC the stylist "worked" two days, the denominator
     * doubles, and utilisation reads at half what it is. Nothing on the screen
     * looks wrong, and the further west the salon the worse the error.
     */
    await segment('an_s1', '2026-05-12T23:00:00Z', '2026-05-13T00:00:00Z')
    await segment('an_s2', '2026-05-13T00:30:00Z', '2026-05-13T01:30:00Z')

    const [wren] = await utilisationReport(S, range, TZ)
    expect(wren?.workedDays).toBe(1)
  })

  it('still counts two real days as two', async () => {
    await segment('an_s3', '2026-05-12T18:00:00Z', '2026-05-12T19:00:00Z')
    await segment('an_s4', '2026-05-14T18:00:00Z', '2026-05-14T19:00:00Z')

    const [wren] = await utilisationReport(S, range, TZ)
    expect(wren?.workedDays).toBe(2)
  })

  it('uses the location’s own zone, not the salon default', async () => {
    // A multi-site salon has one default and several real clocks.
    await unsafeDb.location.create({
      data: { id: 'an_loc2', salonId: S, name: 'London', timezone: 'Europe/London' },
    })
    await unsafeDb.appointmentSegment.create({
      data: {
        salonId: S,
        locationId: 'an_loc2',
        stylistProfileId: 'an_sty',
        kind: 'ACTIVE',
        startsAt: new Date('2026-05-12T22:00:00Z'),
        endsAt: new Date('2026-05-12T23:00:00Z'),
      },
    })

    // 22:00 UTC on 12 May is 23:00 on 12 May in London — still one day there.
    const [wren] = await utilisationReport(S, range, TZ)
    expect(wren?.workedDays).toBe(1)
  })
})
