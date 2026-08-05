import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { loadConsultation, saveAnswer, startConsultation } from '@/server/services/consultation'
import { currentColourOf } from '@/server/services/photos'

/**
 * Which form a basket gets asked to fill in, and how many photos it is held up
 * for.
 *
 * Both used to be one answer for everybody: the salon's single published
 * template regardless of service, and a photo set derived from the chemistry
 * alone. So booking a haircut asked about box dye, henna and previous bleach —
 * and a stranger booking that same haircut was asked for nothing at all, which
 * is the opposite mistake and costs forty minutes in the chair.
 *
 * These two behaviours ship together because they are the same question asked
 * twice: what does this appointment actually need to know?
 */

const S = 'ct_salon'

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'ct-salon',
      name: 'Template Test Salon',
      settings: { create: {} },
      serviceCategories: { create: { id: 'ct_cat', name: 'All', slug: 'all' } },
    },
  })

  const service = (id: string, name: string, extra: Record<string, boolean> = {}) =>
    unsafeDb.service.create({
      data: {
        id,
        salonId: S,
        categoryId: 'ct_cat',
        name,
        slug: id,
        basePriceCents: 10000,
        baseComplexity: 5,
        ...extra,
      },
    })

  await service('ct_bal', 'Full balayage', { isChemical: true, isLightening: true })
  await service('ct_gloss', 'Gloss', { isChemical: true, containsDye: true })
  await service('ct_cut', 'Cut & finish')
  await service('ct_treat', 'Bond treatment')

  await unsafeDb.clientProfile.create({
    data: { id: 'ct_new', salonId: S, firstName: 'Stranger', lastName: 'One', completedVisits: 0 },
  })
  await unsafeDb.clientProfile.create({
    data: { id: 'ct_reg', salonId: S, firstName: 'Regular', lastName: 'Two', completedVisits: 9 },
  })
}

/** Templates vary per test, so they are written per test rather than in seed. */
async function template(key: string, appliesToServiceIds: string[], version = 1) {
  return unsafeDb.consultationTemplate.create({
    data: {
      salonId: S,
      key,
      version,
      name: key,
      status: 'PUBLISHED',
      appliesToServiceIds,
    },
    select: { id: true, key: true },
  })
}

const keyOf = async (consultationId: string) =>
  (
    await unsafeDb.consultation.findUniqueOrThrow({
      where: { id: consultationId },
      select: { template: { select: { key: true } } },
    })
  ).template.key

const startFor = (serviceIds: string[], clientProfileId = 'ct_reg') =>
  startConsultation({ salonId: S, clientProfileId, serviceIds })

beforeAll(seed, 90_000)

beforeEach(async () => {
  await unsafeDb.consultation.deleteMany({ where: { salonId: S } })
  await unsafeDb.consultationTemplate.deleteMany({ where: { salonId: S } })
})

afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.$disconnect()
})

describe('which form the basket gets', () => {
  beforeEach(async () => {
    await template('colour', ['ct_bal', 'ct_gloss'])
    await template('care', [])
  })

  it('hands a colour service the form written for it', async () => {
    expect(await keyOf(await startFor(['ct_bal']))).toBe('colour')
  })

  // The whole point: a cut is not asked about box dye.
  it('hands a cut the general form instead', async () => {
    expect(await keyOf(await startFor(['ct_cut']))).toBe('care')
  })

  it('hands a service nobody named the general form too', async () => {
    expect(await keyOf(await startFor(['ct_treat']))).toBe('care')
  })

  /*
   * Strictest service wins, mirroring `requiredPhotoViews`. Somebody having a
   * cut and a balayage in one sitting is having a colour appointment with a
   * haircut in it, and the colour is the part being assessed.
   */
  it('gives a mixed basket the form for the risky half', async () => {
    expect(await keyOf(await startFor(['ct_cut', 'ct_bal']))).toBe('colour')
    expect(await keyOf(await startFor(['ct_bal', 'ct_cut']))).toBe('colour')
  })

  it('is not decided by the order services were added', async () => {
    expect(await keyOf(await startFor(['ct_gloss', 'ct_treat']))).toBe('colour')
    expect(await keyOf(await startFor(['ct_treat', 'ct_gloss']))).toBe('colour')
  })
})

describe('when a salon has not written a general form', () => {
  it('uses the specific one rather than refusing the booking', async () => {
    // A colour form on a haircut is a worse experience than it could be. Not
    // taking the booking at all is a worse business.
    await template('colour', ['ct_bal'])
    expect(await keyOf(await startFor(['ct_cut']))).toBe('colour')
  })

  it('prefers the template naming the most of what is in the basket', async () => {
    await template('narrow', ['ct_bal'])
    await template('broad', ['ct_bal', 'ct_gloss'])
    expect(await keyOf(await startFor(['ct_bal', 'ct_gloss']))).toBe('broad')
  })

  it('refuses only when the salon has published nothing at all', async () => {
    await expect(startFor(['ct_cut'])).rejects.toThrow(/no published consultation form/i)
  })

  it('ignores a draft form, which is somebody mid-edit', async () => {
    await unsafeDb.consultationTemplate.create({
      data: { salonId: S, key: 'draft', version: 1, name: 'Draft', status: 'DRAFT' },
    })
    await expect(startFor(['ct_cut'])).rejects.toThrow(/no published consultation form/i)
  })

  it('takes an explicit key over anything it would have chosen', async () => {
    await template('colour', ['ct_bal'])
    await template('care', [])
    const id = await startConsultation({
      salonId: S,
      clientProfileId: 'ct_reg',
      serviceIds: ['ct_cut'],
      templateKey: 'colour',
    })
    expect(await keyOf(id)).toBe('colour')
  })
})

describe('where the client’s hair is now', () => {
  /*
   * Read for the reference-picture comparison, which is the one place a client
   * is told the distance between the photo they saved and their own head while
   * they can still act on it.
   */
  async function templateWithShade(key: string, factKey: string) {
    const tpl = await template(key, [])
    await unsafeDb.consultationQuestion.create({
      data: {
        salonId: S,
        templateId: tpl.id,
        // Deliberately not named after the fact. A salon may call its questions
        // anything, and both seeded templates already do.
        key: 'whatever_they_called_it',
        section: 'Your hair',
        sortOrder: 0,
        prompt: 'What colour is it?',
        inputType: 'LEVEL_PICKER',
        factKey,
        isRequired: true,
      },
    })
    return tpl
  }

  it('takes the shade they just answered, matched by fact path not question key', async () => {
    await templateWithShade('shade', 'hair.naturalLevel')
    const id = await startFor(['ct_cut'])
    await saveAnswer({
      salonId: S,
      consultationId: id,
      questionKey: 'whatever_they_called_it',
      value: { level: 5, tone: 'NATURAL_LIGHT_BROWN' },
    })

    expect(await currentColourOf(S, id)).toEqual({
      shadeKey: 'NATURAL_LIGHT_BROWN',
      level: 5,
    })
  })

  it('prefers the current level over the natural one, since that is what a colour sits on', async () => {
    const tpl = await templateWithShade('shade', 'hair.naturalLevel')
    await unsafeDb.consultationQuestion.create({
      data: {
        salonId: S,
        templateId: tpl.id,
        key: 'now',
        section: 'Your hair',
        sortOrder: 1,
        prompt: 'And what colour is it right now?',
        inputType: 'LEVEL_PICKER',
        factKey: 'hair.currentLevel.mids',
        isRequired: true,
      },
    })

    const id = await startFor(['ct_cut'])
    await saveAnswer({
      salonId: S,
      consultationId: id,
      questionKey: 'whatever_they_called_it',
      value: { level: 5, tone: 'NATURAL_LIGHT_BROWN' },
    })
    await saveAnswer({
      salonId: S,
      consultationId: id,
      questionKey: 'now',
      value: { level: 9, tone: 'BLONDE_BEIGE_BLONDE' },
    })

    expect((await currentColourOf(S, id)).level).toBe(9)
  })

  /*
   * The non-colour form asks no shade question at all, so this is an ordinary
   * case rather than an edge one — and a client on file still has a depth.
   */
  it('falls back to the hair profile when the form never asked', async () => {
    await template('care', [])
    await unsafeDb.hairProfile.create({
      data: { salonId: S, clientProfileId: 'ct_reg', currentLevelMids: 7 },
    })
    try {
      const id = await startFor(['ct_cut'], 'ct_reg')
      // No shade key on the profile, so depth only. The comparison takes either.
      expect(await currentColourOf(S, id)).toEqual({ shadeKey: null, level: 7 })
    } finally {
      await unsafeDb.hairProfile.deleteMany({ where: { clientProfileId: 'ct_reg' } })
    }
  })

  it('says it does not know rather than guessing a level', async () => {
    await template('care', [])
    const id = await startFor(['ct_cut'], 'ct_new')
    expect(await currentColourOf(S, id)).toEqual({ shadeKey: null, level: null })
  })
})

describe('how many photos a cut is held up for', () => {
  beforeEach(async () => {
    await template('care', [])
  })

  /*
   * A regular's shape is on file from every previous visit. Asking again is the
   * kind of busywork that teaches clients the consultation is a formality.
   */
  it('asks a returning client for none', async () => {
    const view = await loadConsultation(S, await startFor(['ct_cut'], 'ct_reg'))
    expect(view.requiredPhotoViews).toEqual([])
    expect(view.suggestedPhotoViews).toEqual(['FRONT', 'BACK'])
  })

  // "Shoulder-length bob" covers a range wide enough to lose forty minutes in.
  it('asks a stranger for their current shape', async () => {
    const view = await loadConsultation(S, await startFor(['ct_cut'], 'ct_new'))
    expect(view.requiredPhotoViews).toEqual(['FRONT', 'BACK'])
    // Not offered twice: it is compulsory now, so the tile is not repeated.
    expect(view.suggestedPhotoViews).toEqual([])
  })

  it('changes nothing about a colour service, which already asked for both', async () => {
    await template('colour', ['ct_bal'])
    const stranger = await loadConsultation(S, await startFor(['ct_bal'], 'ct_new'))
    const regular = await loadConsultation(S, await startFor(['ct_bal'], 'ct_reg'))
    expect(stranger.requiredPhotoViews).toEqual(regular.requiredPhotoViews)
    expect(stranger.requiredPhotoViews).toContain('TEXTURE')
  })
})
