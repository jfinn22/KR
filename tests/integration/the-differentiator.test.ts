import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { handoffCard } from '@/server/services/handoff'
import {
  addConsultationVideo,
  consultationVideos,
  removeConsultationVideo,
} from '@/server/services/consultation-video'
import { journeyFor, targetColourOf } from '@/server/services/photos'
import type { EvaluationResult } from '@/domain/consultation/types'

/**
 * The parts that are supposed to be worth switching for.
 *
 * A journey drawn honestly, everything the person doing the hair needs on one
 * screen, and a clip of the hair moving for the consultations a still cannot
 * serve.
 */

const S = 'df_salon'

/** Enough of an evaluation for the journey to read the bits it needs. */
function evaluationWith(sessionCount: number, labels: string[]): EvaluationResult {
  return {
    plan: {
      sessionCount,
      strategy: null,
      rationale: 'test',
      sessions: labels.map((label, index) => ({
        sequence: index + 1,
        label,
        serviceIds: ['df_svc'],
        estimatedDurationMin: 120,
        estimatedPriceCents: 20_000,
        depositCents: 0,
        minDaysAfterPrevious: index === 0 ? null : 42,
        maxDaysAfterPrevious: index === 0 ? null : 84,
      })),
    },
  } as unknown as EvaluationResult
}

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'df-' } } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'df-salon',
      name: 'Differentiator Test Salon',
      settings: { create: {} },
      locations: { create: { id: 'df_loc', name: 'Main' } },
      serviceCategories: { create: { id: 'df_cat', name: 'Colour', slug: 'colour' } },
    },
  })

  await unsafeDb.user.create({ data: { id: 'df_user', email: 'df-sty@example.com' } })
  await unsafeDb.membership.create({
    data: { id: 'df_mem', salonId: S, userId: 'df_user', role: 'STYLIST' },
  })
  await unsafeDb.stylistProfile.create({
    data: { id: 'df_sty', salonId: S, membershipId: 'df_mem', displayName: 'Wren' },
  })
  await unsafeDb.service.create({
    data: {
      id: 'df_svc',
      salonId: S,
      categoryId: 'df_cat',
      name: 'Colour correction',
      slug: 'correction',
      basePriceCents: 30_000,
      isChemical: true,
      isLightening: true,
      requiresPatchTest: true,
    },
  })
  await unsafeDb.consultationTemplate.create({
    data: {
      id: 'df_tpl',
      salonId: S,
      key: 'df-colour',
      name: 'Colour',
      version: 1,
      status: 'PUBLISHED',
    },
  })
}

beforeAll(seed, 90_000)

beforeEach(async () => {
  await unsafeDb.consultationVideo.deleteMany({ where: { salonId: S } })
  await unsafeDb.photoAsset.deleteMany({ where: { salonId: S } })
  await unsafeDb.riskFlag.deleteMany({ where: { salonId: S } })
  await unsafeDb.ruleEvaluation.deleteMany({ where: { salonId: S } })
  await unsafeDb.appointmentSegment.deleteMany({ where: { salonId: S } })
  await unsafeDb.formula.deleteMany({ where: { salonId: S } })
  await unsafeDb.appointment.deleteMany({ where: { salonId: S } })
  await unsafeDb.consultation.deleteMany({ where: { salonId: S } })
  await unsafeDb.patchTest.deleteMany({ where: { salonId: S } })
  await unsafeDb.clientProfile.deleteMany({ where: { salonId: S } })
})

afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'df-' } } })
  await unsafeDb.$disconnect()
})

async function makeClient(name = 'Ada') {
  return unsafeDb.clientProfile.create({
    data: { salonId: S, firstName: name, lastName: 'Rivera' },
    select: { id: true },
  })
}

/** A flag needs an evaluation to hang off, same as a real one would. */
async function makeEvaluation(consultationId: string) {
  const row = await unsafeDb.ruleEvaluation.create({
    data: {
      salonId: S,
      consultationId,
      rulesetVersion: 'test',
      rulesetHash: 'test',
      inputHash: 'test',
      inputSnapshotJson: {},
      outputSnapshotJson: {},
      engineMs: 1,
      triggeredBy: 'SUBMIT',
    },
    select: { id: true },
  })
  return row.id
}

async function makeConsultation(clientProfileId: string, extra: Record<string, unknown> = {}) {
  return unsafeDb.consultation.create({
    data: {
      salonId: S,
      clientProfileId,
      templateId: 'df_tpl',
      templateVersion: 1,
      requestedServiceIds: ['df_svc'],
      status: 'SUBMITTED',
      ...extra,
    },
    select: { id: true },
  })
}

async function makeAppointment(clientProfileId: string, consultationId?: string) {
  return unsafeDb.appointment.create({
    data: {
      salonId: S,
      locationId: 'df_loc',
      clientProfileId,
      primaryStylistId: 'df_sty',
      consultationId: consultationId ?? null,
      status: 'BOOKED',
      startsAt: new Date('2026-10-05T14:00:00Z'),
      endsAt: new Date('2026-10-05T17:00:00Z'),
      estimatedDurationMin: 180,
      estimatedTotalCents: 30_000,
      services: {
        create: {
          salonId: S,
          serviceId: 'df_svc',
          stylistProfileId: 'df_sty',
          sequence: 0,
          plannedDurationMin: 180,
          priceCents: 30_000,
        },
      },
    },
    select: { id: true },
  })
}

// ---------------------------------------------------------------------------

describe('the journey, off real rows', () => {
  async function taggedTarget(consultationId: string, key: string, value: string) {
    const photo = await unsafeDb.inspirationPhoto.create({
      data: { salonId: S, consultationId, sequence: 0 },
      select: { id: true },
    })
    await unsafeDb.inspirationAttribute.create({
      data: { salonId: S, inspirationPhotoId: photo.id, key: key as never, value },
    })
  }

  it('reads the target off the reference picture the client tagged', async () => {
    const client = await makeClient()
    const consultation = await makeConsultation(client.id)
    await taggedTarget(consultation.id, 'TARGET_TONE', 'BLONDE_PLATINUM')

    const target = await targetColourOf(S, consultation.id)
    expect(target.shadeKey).toBe('BLONDE_PLATINUM')
  })

  it('accepts a bare level when no shade was picked', async () => {
    const client = await makeClient()
    const consultation = await makeConsultation(client.id)
    await taggedTarget(consultation.id, 'TARGET_LEVEL', '9')

    expect((await targetColourOf(S, consultation.id)).level).toBe(9)
  })

  it('clamps a level somebody typed out of range rather than drawing off the end', async () => {
    const client = await makeClient()
    const consultation = await makeConsultation(client.id)
    await taggedTarget(consultation.id, 'TARGET_LEVEL', '47')

    expect((await targetColourOf(S, consultation.id)).level).toBe(10)
  })

  it('draws the stages nobody finishes on', async () => {
    const client = await makeClient()
    await unsafeDb.hairProfile.create({
      data: { salonId: S, clientProfileId: client.id, currentLevelMids: 4 },
    })
    const consultation = await makeConsultation(client.id)
    await taggedTarget(consultation.id, 'TARGET_TONE', 'BLONDE_PLATINUM')

    const journey = await journeyFor(
      S,
      consultation.id,
      evaluationWith(3, ['First lift', 'Second lift', 'Tone and finish']),
    )

    expect(journey).not.toBeNull()
    expect(journey!.visits).toBe(3)
    // Four rungs: where they are, then one per visit.
    expect(journey!.rungs).toHaveLength(4)
    // The middle two are raw lifted hair, not the target tone.
    expect(journey!.rungs.filter((r) => r.isStagingPost)).toHaveLength(2)
    expect(journey!.rungs.at(-1)!.toneName).toBe('Platinum')
    // The plan's own labels, not invented ones.
    expect(journey!.rungs[1]!.label).toBe('First lift')
  })

  it('draws nothing when the client never levelled their reference', async () => {
    const client = await makeClient()
    const consultation = await makeConsultation(client.id)

    // Not an error — most references are never tagged, and the client still
    // gets everything else on the screen.
    expect(await journeyFor(S, consultation.id, evaluationWith(1, ['Appointment']))).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('the handoff card', () => {
  it('puts a missing patch test above everything else', async () => {
    const client = await makeClient()
    const consultation = await makeConsultation(client.id)
    const appointment = await makeAppointment(client.id, consultation.id)

    const card = await handoffCard(S, appointment.id)

    expect(card.stoppers[0]).toMatchObject({ kind: 'PATCH_TEST', severity: 'BLOCKER' })
  })

  it('does not raise a patch test for work that does not need one', async () => {
    await unsafeDb.service.update({
      where: { id: 'df_svc' },
      data: { requiresPatchTest: false },
    })
    try {
      const client = await makeClient()
      const appointment = await makeAppointment(client.id)
      const card = await handoffCard(S, appointment.id)

      // Crying wolf here is how a stylist learns to scroll past this panel.
      expect(card.stoppers.some((s) => s.kind === 'PATCH_TEST')).toBe(false)
    } finally {
      await unsafeDb.service.update({
        where: { id: 'df_svc' },
        data: { requiresPatchTest: true },
      })
    }
  })

  it('leaves settled business out of the warnings', async () => {
    const client = await makeClient()
    const consultation = await makeConsultation(client.id)
    const appointment = await makeAppointment(client.id, consultation.id)

    const evaluationId = await makeEvaluation(consultation.id)
    await unsafeDb.riskFlag.createMany({
      data: [
        {
          salonId: S,
          consultationId: consultation.id,
          evaluationId,
          evidenceJson: {},
          ruleId: 'r1',
          ruleVersion: 1,
          code: 'DONE',
          severity: 'HIGH',
          title: 'Already dealt with',
          detail: 'x',
          recommendedPath: 'x',
          status: 'RESOLVED',
        },
        {
          salonId: S,
          consultationId: consultation.id,
          evaluationId,
          evidenceJson: {},
          ruleId: 'r2',
          ruleVersion: 1,
          code: 'LIVE',
          severity: 'CAUTION',
          title: 'Still open',
          detail: 'x',
          recommendedPath: 'x',
          status: 'OPEN',
        },
      ],
    })

    const card = await handoffCard(S, appointment.id)
    const titles = card.stoppers.map((s) => s.title)

    expect(titles).toContain('Still open')
    expect(titles).not.toContain('Already dealt with')
  })

  it('separates what was signed off from what was not', async () => {
    const client = await makeClient()
    const consultation = await makeConsultation(client.id)
    const appointment = await makeAppointment(client.id, consultation.id)

    await unsafeDb.riskFlag.create({
      data: {
        salonId: S,
        consultationId: consultation.id,
        evaluationId: await makeEvaluation(consultation.id),
        evidenceJson: {},
        ruleId: 'r3',
        ruleVersion: 1,
        code: 'OVR',
        severity: 'HIGH',
        title: 'Overridden by a manager',
        detail: 'x',
        recommendedPath: 'x',
        status: 'OVERRIDDEN',
        overrideReason: 'Client has had this four times.',
        overriddenByUserId: 'df_user',
      },
    })

    const card = await handoffCard(S, appointment.id)
    const overridden = card.stoppers.find((s) => s.title === 'Overridden by a manager')

    // "Somebody decided this was fine" is a different thing from "this never
    // came up", and the person doing the work is entitled to know which.
    expect(overridden?.overriddenBy).toBeTruthy()
    expect(overridden?.overrideReason).toMatch(/four times/i)
  })

  it('shows the last formula from a different visit, not this one', async () => {
    const client = await makeClient()
    const previous = await makeAppointment(client.id)
    const current = await makeAppointment(client.id)

    await unsafeDb.formula.create({
      data: {
        salonId: S,
        clientProfileId: client.id,
        appointmentId: previous.id,
        stylistProfileId: 'df_sty',
        purpose: 'GLOBAL_COLOR',
        developerVolume: 20,
        applicationNotes: 'Banded at the mids.',
        components: {
          create: {
            salonId: S,
            sequence: 0,
            brand: 'Wella',
            productName: 'Koleston',
            shadeCode: '8/0',
            parts: 1,
            role: 'BASE',
          },
        },
      },
    })

    // Written against the appointment being prepared — must not be shown back.
    await unsafeDb.formula.create({
      data: {
        salonId: S,
        clientProfileId: client.id,
        appointmentId: current.id,
        stylistProfileId: 'df_sty',
        purpose: 'GLOBAL_COLOR',
        applicationNotes: 'Today.',
      },
    })

    const card = await handoffCard(S, current.id)
    expect(card.lastFormula?.applicationNotes).toBe('Banded at the mids.')
    expect(card.lastFormula?.components[0]?.product).toContain('Koleston')
    // Decimal on the way out of Prisma; a number by the time a screen sees it.
    expect(typeof card.lastFormula?.components[0]?.parts).toBe('number')
  })

  it('names who consulted only when it was somebody else', async () => {
    const client = await makeClient()
    const appointment = await makeAppointment(client.id)

    const card = await handoffCard(S, appointment.id)
    // Same stylist, so the line would cost a glance and say nothing.
    expect(card.appointment.consultedBy).toBeNull()
  })

  it('survives an allergies field holding something unexpected', async () => {
    const client = await makeClient()
    await unsafeDb.hairProfile.create({
      data: {
        salonId: S,
        clientProfileId: client.id,
        allergiesJson: { something: 'older' },
      },
    })
    const appointment = await makeAppointment(client.id)

    // This is the one screen that must always render.
    const card = await handoffCard(S, appointment.id)
    expect(card.client.allergies).toEqual([])
  })
})

// ---------------------------------------------------------------------------

describe('a clip of the hair moving', () => {
  const clip = Buffer.from('not really an mp4, but bytes are bytes')

  it('stores it and hands back a playable url', async () => {
    const client = await makeClient()
    const consultation = await makeConsultation(client.id)

    await addConsultationVideo({
      salonId: S,
      consultationId: consultation.id,
      clientProfileId: client.id,
      bytes: clip,
      contentType: 'video/mp4',
      prompt: 'Turn your head slowly.',
      durationSec: 22,
    })

    const videos = await consultationVideos(S, consultation.id)
    expect(videos).toHaveLength(1)
    expect(videos[0]!.url).toBeTruthy()
    expect(videos[0]!.prompt).toMatch(/turn your head/i)
  })

  it('refuses something that is not a video', async () => {
    const client = await makeClient()
    const consultation = await makeConsultation(client.id)

    await expect(
      addConsultationVideo({
        salonId: S,
        consultationId: consultation.id,
        clientProfileId: client.id,
        bytes: clip,
        contentType: 'image/jpeg',
      }),
    ).rejects.toThrow(/MP4, MOV or WebM/i)
  })

  it('refuses a clip longer than anybody will watch', async () => {
    const client = await makeClient()
    const consultation = await makeConsultation(client.id)

    await expect(
      addConsultationVideo({
        salonId: S,
        consultationId: consultation.id,
        clientProfileId: client.id,
        bytes: clip,
        contentType: 'video/mp4',
        durationSec: 240,
      }),
    ).rejects.toThrow(/under 60 seconds|under 60/i)
  })

  it('does not appear in the photo queries', async () => {
    /*
     * A separate table exists precisely so every existing query for photos
     * keeps returning photos. If a video showed up in the photo grid the
     * client would see a broken tile.
     */
    const client = await makeClient()
    const consultation = await makeConsultation(client.id)
    await addConsultationVideo({
      salonId: S,
      consultationId: consultation.id,
      clientProfileId: client.id,
      bytes: clip,
      contentType: 'video/mp4',
    })

    expect(
      await unsafeDb.consultationPhoto.count({ where: { consultationId: consultation.id } }),
    ).toBe(0)
  })

  it('soft-deletes the asset on removal, the same as a photo does', async () => {
    const client = await makeClient()
    const consultation = await makeConsultation(client.id)
    const { id } = await addConsultationVideo({
      salonId: S,
      consultationId: consultation.id,
      clientProfileId: client.id,
      bytes: clip,
      contentType: 'video/mp4',
    })

    const before = await unsafeDb.consultationVideo.findUniqueOrThrow({ where: { id } })
    await removeConsultationVideo({ salonId: S, videoId: id })

    expect(await unsafeDb.consultationVideo.count({ where: { id } })).toBe(0)

    /*
     * The asset survives, marked. A hard delete is the erasure job's business:
     * it is the only thing that knows whether the same asset backs a record
     * somewhere that has already been approved.
     */
    const asset = await unsafeDb.photoAsset.findUniqueOrThrow({
      where: { id: before.photoAssetId },
    })
    expect(asset.deletedAt).not.toBeNull()
  })

  it('refuses to change a consultation that has been approved', async () => {
    const client = await makeClient()
    const consultation = await makeConsultation(client.id)
    const { id } = await addConsultationVideo({
      salonId: S,
      consultationId: consultation.id,
      clientProfileId: client.id,
      bytes: clip,
      contentType: 'video/mp4',
    })

    await unsafeDb.consultation.update({
      where: { id: consultation.id },
      data: { status: 'APPROVED' },
    })

    await expect(removeConsultationVideo({ salonId: S, videoId: id })).rejects.toThrow(/closed/i)
  })
})

// ---------------------------------------------------------------------------

describe('in-chair consultations', () => {
  it('record that somebody was looking at the hair', async () => {
    const client = await makeClient()
    const consultation = await makeConsultation(client.id, { startedInChair: true })

    const row = await unsafeDb.consultation.findUniqueOrThrow({ where: { id: consultation.id } })
    expect(row.startedInChair).toBe(true)
    /*
     * Distinct from `mode`, which the engine overwrites on every evaluation.
     * This is a fact about how it happened and nothing recomputes it.
     */
    expect(row.mode).toBe('DIGITAL')
  })

  it('default to not, so nothing claims an observation it did not make', async () => {
    const client = await makeClient()
    const consultation = await makeConsultation(client.id)

    expect(
      (await unsafeDb.consultation.findUniqueOrThrow({ where: { id: consultation.id } }))
        .startedInChair,
    ).toBe(false)
  })
})
