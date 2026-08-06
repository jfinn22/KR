import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import {
  recordStrandTest,
  requirementsFor,
  strandTestsFor,
  waiveRequirement,
} from '@/server/services/requirements'

/**
 * The things that have to happen before the work can.
 *
 * `PreRequirement` rows are written when a consultation is evaluated and read
 * by the handoff card, and nothing could ever move one off `PENDING` —
 * `SATISFIED`, `WAIVED` and `FAILED` had no writer, and neither did the three
 * `satisfiedBy…` columns. A stylist who did the strand test the engine demanded
 * watched the screen go on demanding it, so the only way past a requirement was
 * to ignore it. `StrandTest`, the model for what the test actually showed, had
 * no writer either.
 */

const S = 'rq_salon'
const CLIENT = 'rq_cli'
const USER = 'rq_user'

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { endsWith: '@rq.test' } } })

  await unsafeDb.user.create({ data: { id: USER, email: 'sty@rq.test', name: 'Nia' } })
  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'rq-salon',
      name: 'Requirements Test Salon',
      defaultTimezone: 'Europe/London',
      settings: { create: {} },
      locations: { create: { id: 'rq_loc', name: 'Main', timezone: 'Europe/London' } },
      clientProfiles: { create: { id: CLIENT, firstName: 'Ada', lastName: 'Rivera' } },
    },
  })
}

async function requirement(kind = 'STRAND_TEST', over: Record<string, unknown> = {}) {
  return unsafeDb.preRequirement.create({
    data: {
      salonId: S,
      kind: kind as never,
      rationale: 'Previous box dye under a high-lift goal.',
      ...over,
    },
    select: { id: true },
  })
}

beforeEach(seed)
afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { endsWith: '@rq.test' } } })
})

describe('recording what a strand test showed', () => {
  it('writes the test and satisfies the requirement that asked for it', async () => {
    const req = await requirement()

    const result = await recordStrandTest({
      salonId: S,
      clientProfileId: CLIENT,
      performedByUserId: USER,
      startLevel: 5,
      liftAchievedLevel: 8,
      integrityAfter: 'FAIR',
      resultNotes: 'Lifted evenly, ends a little soft.',
      decision: 'PROCEED',
    })

    expect(result.strandTestId).toBeTruthy()
    expect(result.requirementStatus).toBe('SATISFIED')

    const row = await unsafeDb.preRequirement.findUniqueOrThrow({ where: { id: req.id } })
    expect(row.status).toBe('SATISFIED')
    // The three columns that had no writer at all.
    expect(row.satisfiedByType).toBe('StrandTest')
    expect(row.satisfiedById).toBe(result.strandTestId)
    expect(row.satisfiedAt).toBeInstanceOf(Date)
  })

  it('FAILS the requirement when the test says do not do it', async () => {
    /*
     * The decision drives the requirement's fate, not the act of testing. A
     * test that says ABORT has satisfied nothing — the hair said no — and
     * marking it satisfied because somebody went through the motions is exactly
     * the box-tick this product exists to avoid.
     */
    const req = await requirement()

    const result = await recordStrandTest({
      salonId: S,
      clientProfileId: CLIENT,
      performedByUserId: USER,
      decision: 'ABORT',
      resultNotes: 'Came away in the bowl.',
    })

    expect(result.requirementStatus).toBe('FAILED')
    expect((await unsafeDb.preRequirement.findUniqueOrThrow({ where: { id: req.id } })).status).toBe(
      'FAILED',
    )
  })

  it('counts MODIFY as satisfied, because the test did its job', async () => {
    const req = await requirement()
    await recordStrandTest({
      salonId: S,
      clientProfileId: CLIENT,
      performedByUserId: USER,
      decision: 'MODIFY',
    })
    expect((await unsafeDb.preRequirement.findUniqueOrThrow({ where: { id: req.id } })).status).toBe(
      'SATISFIED',
    )
  })

  it('records the test even when nothing asked for one', async () => {
    // A stylist testing on their own judgement is good practice, not an error.
    const result = await recordStrandTest({
      salonId: S,
      clientProfileId: CLIENT,
      performedByUserId: USER,
      decision: 'PROCEED',
    })
    expect(result.strandTestId).toBeTruthy()
    expect(result.requirementStatus).toBeNull()
  })

  it('leaves other kinds of requirement alone', async () => {
    const patch = await requirement('PATCH_TEST')
    await recordStrandTest({
      salonId: S,
      clientProfileId: CLIENT,
      performedByUserId: USER,
      decision: 'PROCEED',
    })
    expect((await unsafeDb.preRequirement.findUniqueOrThrow({ where: { id: patch.id } })).status).toBe(
      'PENDING',
    )
  })

  it('refuses a client from another salon', async () => {
    await expect(
      recordStrandTest({
        salonId: S,
        clientProfileId: 'somebody_else',
        performedByUserId: USER,
        decision: 'PROCEED',
      }),
    ).rejects.toThrow(/not here/)
  })

  it('keeps the tests readable back, newest first', async () => {
    await recordStrandTest({
      salonId: S,
      clientProfileId: CLIENT,
      performedByUserId: USER,
      decision: 'ABORT',
      now: new Date('2026-05-01T10:00:00Z'),
    })
    await recordStrandTest({
      salonId: S,
      clientProfileId: CLIENT,
      performedByUserId: USER,
      decision: 'PROCEED',
      now: new Date('2026-06-01T10:00:00Z'),
    })

    const tests = await strandTestsFor(S, CLIENT)
    expect(tests).toHaveLength(2)
    expect(tests[0]?.decision).toBe('PROCEED')
  })
})

describe('going ahead without it', () => {
  it('waives with a reason, and keeps who decided', async () => {
    const req = await requirement()

    expect(
      await waiveRequirement({
        salonId: S,
        requirementId: req.id,
        waivedByUserId: USER,
        reason: 'Client has had this exact service here twice this year.',
      }),
    ).toEqual({ status: 'WAIVED' })

    const row = await unsafeDb.preRequirement.findUniqueOrThrow({ where: { id: req.id } })
    expect(row.status).toBe('WAIVED')
    expect(row.waivedByUserId).toBe(USER)
    expect(row.waiveReason).toMatch(/twice this year/)
  })

  it('refuses to waive one that is already dealt with', async () => {
    const req = await requirement()
    await recordStrandTest({
      salonId: S,
      clientProfileId: CLIENT,
      performedByUserId: USER,
      decision: 'PROCEED',
    })

    await expect(
      waiveRequirement({
        salonId: S,
        requirementId: req.id,
        waivedByUserId: USER,
        reason: 'Trying to waive something already satisfied.',
      }),
    ).rejects.toThrow(/not outstanding/)
  })

  it('refuses another salon’s requirement', async () => {
    await expect(
      waiveRequirement({
        salonId: S,
        requirementId: 'not_ours',
        waivedByUserId: USER,
        reason: 'Should not be possible at all.',
      }),
    ).rejects.toThrow(/not outstanding/)
  })
})

describe('reading them back', () => {
  it('returns nothing when asked about neither a consultation nor a plan', async () => {
    await requirement()
    expect(await requirementsFor(S, {})).toEqual([])
  })

  it('narrows to the consultation that raised them', async () => {
    const template = await unsafeDb.consultationTemplate.create({
      data: { salonId: S, key: 'rq-template', name: 'Test template', status: 'PUBLISHED' },
      select: { id: true },
    })
    const consultation = await unsafeDb.consultation.create({
      data: {
        salon: { connect: { id: S } },
        clientProfile: { connect: { id: CLIENT } },
        template: { connect: { id: template.id } },
        status: 'SUBMITTED',
        templateVersion: 1,
      },
      select: { id: true },
    })
    await requirement('STRAND_TEST', { consultationId: consultation.id })
    await requirement('PATCH_TEST')

    const rows = await requirementsFor(S, { consultationId: consultation.id })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('STRAND_TEST')
  })
})
