import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { evaluateConsultation, saveAnswer, startConsultation } from '@/server/services/consultation'
import {
  loadPlan,
  maybeAutoApprove,
  reviewConsultation,
  sessionBookability,
} from '@/server/services/service-plan'
import { capableStylists, replacePhases, toChainSpec, toFactSpec } from '@/server/services/catalog'
import { chainDuration } from '@/domain/scheduling/chain'

/**
 * Approval turns an evaluation into a bookable plan. The behaviour that matters
 * most is FREEZING: a salon editing a service next month must not change the
 * shape of an appointment somebody already agreed to.
 */

const S = 'sp_salon'

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'sp-' } } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'sp-salon',
      name: 'Plan Test Salon',
      settings: { create: { autoApproveSimple: false } },
      locations: { create: { id: 'sp_loc', name: 'Main' } },
      serviceCategories: { create: { id: 'sp_cat', name: 'Colour', slug: 'colour' } },
    },
  })

  await unsafeDb.user.create({ data: { id: 'sp_user', email: 'sp-sty@example.com' } })
  await unsafeDb.membership.create({
    data: { id: 'sp_mem', salonId: S, userId: 'sp_user', role: 'STYLIST' },
  })
  await unsafeDb.stylistProfile.create({
    data: { id: 'sp_sty', salonId: S, membershipId: 'sp_mem', displayName: 'Rowan' },
  })
  await unsafeDb.stylistSkill.create({
    data: { salonId: S, stylistProfileId: 'sp_sty', skillCode: 'BALAYAGE', level: 5 },
  })

  // Balayage: active work, a processing gap, then the basin.
  await unsafeDb.service.create({
    data: {
      id: 'sp_bal',
      salonId: S,
      categoryId: 'sp_cat',
      name: 'Full balayage',
      slug: 'balayage',
      basePriceCents: 22000,
      baseComplexity: 15,
      isChemical: true,
      isLightening: true,
      requiredSkillCode: 'BALAYAGE',
      requiredSkillLevel: 3,
      phases: {
        create: [
          {
            salonId: S,
            sequence: 0,
            kind: 'ACTIVE',
            label: 'Application',
            durationMin: 90,
            requiresStylist: true,
            requiresResourceType: 'CHAIR',
            isScalable: true,
          },
          {
            salonId: S,
            sequence: 1,
            kind: 'PROCESSING',
            label: 'Processing',
            durationMin: 40,
            requiresStylist: false,
            requiresResourceType: 'PROCESSING_SEAT',
            isScalable: false,
          },
          {
            salonId: S,
            sequence: 2,
            kind: 'ACTIVE',
            label: 'Tone',
            durationMin: 45,
            requiresStylist: true,
            requiresResourceType: 'CHAIR',
            isScalable: true,
          },
        ],
      },
    },
  })

  // A simple, unflagged service, for the auto-approval path.
  await unsafeDb.service.create({
    data: {
      id: 'sp_cut',
      salonId: S,
      categoryId: 'sp_cat',
      name: 'Cut & finish',
      slug: 'cut',
      basePriceCents: 6500,
      baseComplexity: 2,
      phases: {
        create: {
          salonId: S,
          sequence: 0,
          kind: 'ACTIVE',
          label: 'Cut',
          durationMin: 45,
          requiresStylist: true,
          requiresResourceType: 'CHAIR',
          isScalable: true,
        },
      },
    },
  })

  await unsafeDb.stylistService.createMany({
    data: [
      { salonId: S, stylistProfileId: 'sp_sty', serviceId: 'sp_bal', isEnabled: true },
      { salonId: S, stylistProfileId: 'sp_sty', serviceId: 'sp_cut', isEnabled: true },
    ],
  })

  const template = await unsafeDb.consultationTemplate.create({
    data: {
      salonId: S,
      key: 'sp-colour',
      version: 1,
      name: 'Colour',
      status: 'PUBLISHED',
    },
  })

  await unsafeDb.consultationQuestion.createMany({
    data: [
      {
        salonId: S,
        templateId: template.id,
        key: 'goal',
        section: 'Goal',
        sortOrder: 0,
        prompt: 'Target level?',
        inputType: 'LEVEL_PICKER',
        factKey: 'goal.targetLevel',
        isRequired: true,
      },
      {
        salonId: S,
        templateId: template.id,
        key: 'boxdye',
        section: 'History',
        sortOrder: 1,
        prompt: 'Box dye?',
        inputType: 'BOOLEAN',
        factKey: 'history.boxDye.ever',
        isRequired: true,
      },
    ],
  })

  await unsafeDb.clientProfile.create({
    data: {
      id: 'sp_cli',
      salonId: S,
      firstName: 'Ada',
      lastName: 'Rivera',
      completedVisits: 5,
      hairProfile: { create: { salonId: S, naturalLevel: 5, currentLevelMids: 5 } },
    },
  })
}

beforeAll(seed, 90_000)

beforeEach(async () => {
  await unsafeDb.servicePlan.deleteMany({ where: { salonId: S } })
  await unsafeDb.consultation.deleteMany({ where: { salonId: S } })
  await unsafeDb.outbox.deleteMany({ where: { salonId: S } })
})

afterAll(async () => {
  // Plans reference services, so they have to go before the salon cascade.
  await unsafeDb.servicePlan.deleteMany({ where: { salonId: S } })
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'sp-' } } })
  await unsafeDb.$disconnect()
})

async function consultFor(serviceIds: string[], answers: Record<string, unknown>) {
  const id = await startConsultation({
    salonId: S,
    clientProfileId: 'sp_cli',
    serviceIds,
    stylistProfileId: 'sp_sty',
    templateKey: 'sp-colour',
  })
  for (const [key, value] of Object.entries(answers)) {
    await saveAnswer({ salonId: S, consultationId: id, questionKey: key, value })
  }
  const evaluation = await evaluateConsultation({ salonId: S, consultationId: id })
  return { id, evaluation }
}

describe('catalog mapping', () => {
  it('preserves phase order and flags into the scheduler spec', async () => {
    const service = await unsafeDb.service.findUniqueOrThrow({
      where: { id: 'sp_bal' },
      include: { phases: { orderBy: { sequence: 'asc' } }, variants: true },
    })
    const spec = toChainSpec(service)

    expect(spec.phases.map((p) => p.kind)).toEqual(
      ['ACTIVE', 'PROCESSING', 'RINSE'].slice(0, 2).concat('ACTIVE'),
    )
    // Processing does not need the stylist — that is what allows interleaving.
    expect(spec.phases[1]!.requiresStylist).toBe(false)
    expect(spec.phases[1]!.isScalable).toBe(false)
  })

  it('carries service character into the rules-engine spec', async () => {
    const service = await unsafeDb.service.findUniqueOrThrow({
      where: { id: 'sp_bal' },
      include: { phases: { orderBy: { sequence: 'asc' } }, variants: true },
    })
    const spec = toFactSpec(service)
    expect(spec.isLightening).toBe(true)
    expect(spec.requiredSkillLevel).toBe(3)
    expect(spec.phases).toHaveLength(3)
  })

  it('only offers a stylist enabled for EVERY requested service', async () => {
    expect(await capableStylists(S, ['sp_bal'])).toHaveLength(1)

    await unsafeDb.stylistService.updateMany({
      where: { stylistProfileId: 'sp_sty', serviceId: 'sp_cut' },
      data: { isEnabled: false },
    })
    // Half an appointment is not a bookable appointment.
    expect(await capableStylists(S, ['sp_bal', 'sp_cut'])).toHaveLength(0)

    await unsafeDb.stylistService.updateMany({
      where: { stylistProfileId: 'sp_sty', serviceId: 'sp_cut' },
      data: { isEnabled: true },
    })
  })

  it('rejects a phase chain with no phases', async () => {
    await expect(replacePhases(S, 'sp_cut', [])).rejects.toThrow(/at least one phase/)
  })
})

describe('approval', () => {
  it('creates a plan with one session for a straightforward service', async () => {
    const { id } = await consultFor(['sp_cut'], { goal: 6, boxdye: false })
    const { status, servicePlanId } = await reviewConsultation({
      salonId: S,
      consultationId: id,
      reviewerUserId: 'sp_user',
      decision: 'APPROVE',
    })

    expect(status).toBe('APPROVED')
    const plan = await loadPlan(S, servicePlanId!)
    expect(plan.totalSessions).toBe(1)
    expect(plan.sessions).toHaveLength(1)
    expect(plan.status).toBe('APPROVED')
  })

  it('creates one session per planned visit for a staged correction', async () => {
    const { id, evaluation } = await consultFor(['sp_bal'], { goal: 9, boxdye: true })
    expect(evaluation.plan.sessionCount).toBeGreaterThan(1)

    const { servicePlanId } = await reviewConsultation({
      salonId: S,
      consultationId: id,
      reviewerUserId: 'sp_user',
      decision: 'APPROVE',
    })

    const plan = await loadPlan(S, servicePlanId!)
    expect(plan.sessions).toHaveLength(evaluation.plan.sessionCount)
    expect(plan.sessions[1]!.minDaysAfterPrevious).toBeGreaterThan(0)
    // A staged correction should stay with one pair of hands.
    expect(plan.requiresStylistContinuity).toBe(true)
  })

  // The guarantee this whole service exists for.
  it('freezes the phase chain, so a later catalog edit cannot change it', async () => {
    const { id } = await consultFor(['sp_bal'], { goal: 7, boxdye: false })
    const { servicePlanId } = await reviewConsultation({
      salonId: S,
      consultationId: id,
      reviewerUserId: 'sp_user',
      decision: 'APPROVE',
    })

    const before = await loadPlan(S, servicePlanId!)
    const frozen = before.sessions[0]!.services[0]!
    const frozenMinutes = chainDuration(frozen.phaseChainJson as never)
    expect(frozenMinutes).toBeGreaterThan(0)

    // The salon doubles the application time next month.
    await replacePhases(S, 'sp_bal', [
      {
        kind: 'ACTIVE',
        label: 'Application',
        durationMin: 180,
        requiresStylist: true,
        requiresResourceType: 'CHAIR',
        isScalable: true,
      },
      {
        kind: 'PROCESSING',
        label: 'Processing',
        durationMin: 40,
        requiresStylist: false,
        requiresResourceType: 'PROCESSING_SEAT',
        isScalable: false,
      },
      {
        kind: 'ACTIVE',
        label: 'Tone',
        durationMin: 45,
        requiresStylist: true,
        requiresResourceType: 'CHAIR',
        isScalable: true,
      },
    ])

    const after = await loadPlan(S, servicePlanId!)
    expect(chainDuration(after.sessions[0]!.services[0]!.phaseChainJson as never)).toBe(
      frozenMinutes,
    )

    // Restore for the other tests.
    await replacePhases(S, 'sp_bal', [
      {
        kind: 'ACTIVE',
        label: 'Application',
        durationMin: 90,
        requiresStylist: true,
        requiresResourceType: 'CHAIR',
        isScalable: true,
      },
      {
        kind: 'PROCESSING',
        label: 'Processing',
        durationMin: 40,
        requiresStylist: false,
        requiresResourceType: 'PROCESSING_SEAT',
        isScalable: false,
      },
      {
        kind: 'ACTIVE',
        label: 'Tone',
        durationMin: 45,
        requiresStylist: true,
        requiresResourceType: 'CHAIR',
        isScalable: true,
      },
    ])
  })

  it('records a stylist override alongside the estimate', async () => {
    const { id } = await consultFor(['sp_bal'], { goal: 7, boxdye: false })
    const { servicePlanId } = await reviewConsultation({
      salonId: S,
      consultationId: id,
      reviewerUserId: 'sp_user',
      decision: 'APPROVE_WITH_CHANGES',
      overrides: { durationMin: 300, priceCents: 30000, depositCents: 12000 },
    })

    const plan = await loadPlan(S, servicePlanId!)
    expect(plan.estimatedTotalMin).toBe(300)
    expect(plan.estimatedTotalCents).toBe(30000)
    expect(plan.depositCents).toBe(12000)
  })

  it('a non-approval records the decision and creates no plan', async () => {
    const { id } = await consultFor(['sp_bal'], { goal: 9, boxdye: true })
    const result = await reviewConsultation({
      salonId: S,
      consultationId: id,
      reviewerUserId: 'sp_user',
      decision: 'REQUEST_IN_PERSON',
      notesToClient: 'Let us look at this together first.',
    })

    expect(result.servicePlanId).toBeNull()
    expect(result.status).toBe('NEEDS_IN_PERSON')
    expect(await unsafeDb.servicePlan.count({ where: { salonId: S } })).toBe(0)
  })

  it('refuses to approve the same consultation twice', async () => {
    const { id } = await consultFor(['sp_cut'], { goal: 6, boxdye: false })
    await reviewConsultation({
      salonId: S,
      consultationId: id,
      reviewerUserId: 'sp_user',
      decision: 'APPROVE',
    })
    await expect(
      reviewConsultation({
        salonId: S,
        consultationId: id,
        reviewerUserId: 'sp_user',
        decision: 'APPROVE',
      }),
    ).rejects.toThrow(/already been approved/)
  })

  it('emits an outbox event so downstream automation can react', async () => {
    const { id } = await consultFor(['sp_cut'], { goal: 6, boxdye: false })
    await reviewConsultation({
      salonId: S,
      consultationId: id,
      reviewerUserId: 'sp_user',
      decision: 'APPROVE',
    })

    const events = await unsafeDb.outbox.findMany({
      where: { salonId: S, topic: 'consultation.approved' },
    })
    expect(events).toHaveLength(1)
  })
})

describe('auto-approval is deliberately conservative', () => {
  it('does nothing while the salon has not opted in', async () => {
    const { id, evaluation } = await consultFor(['sp_cut'], { goal: 6, boxdye: false })
    expect(evaluation.recommendedDecision).toBe('AUTO_APPROVE_ELIGIBLE')
    expect(await maybeAutoApprove({ salonId: S, consultationId: id, evaluation })).toBeNull()
  })

  it('approves a simple unflagged service once the salon opts in', async () => {
    await unsafeDb.salonSettings.update({
      where: { salonId: S },
      data: { autoApproveSimple: true },
    })

    const { id, evaluation } = await consultFor(['sp_cut'], { goal: 6, boxdye: false })
    const planId = await maybeAutoApprove({ salonId: S, consultationId: id, evaluation })
    expect(planId).not.toBeNull()

    const review = await unsafeDb.consultationReview.findFirst({ where: { consultationId: id } })
    expect(review?.notesInternal).toMatch(/Auto-approved/)
  })

  // The entire point of the product: anything risky waits for a human.
  it('never auto-approves a flagged consultation, even when opted in', async () => {
    const { id, evaluation } = await consultFor(['sp_bal'], { goal: 9, boxdye: true })
    expect(evaluation.flags.length).toBeGreaterThan(0)
    expect(evaluation.recommendedDecision).not.toBe('AUTO_APPROVE_ELIGIBLE')
    expect(await maybeAutoApprove({ salonId: S, consultationId: id, evaluation })).toBeNull()

    await unsafeDb.salonSettings.update({
      where: { salonId: S },
      data: { autoApproveSimple: false },
    })
  })
})

describe('session bookability', () => {
  it('session one is bookable immediately', async () => {
    const { id } = await consultFor(['sp_cut'], { goal: 6, boxdye: false })
    const { servicePlanId } = await reviewConsultation({
      salonId: S,
      consultationId: id,
      reviewerUserId: 'sp_user',
      decision: 'APPROVE',
    })
    expect((await sessionBookability(S, servicePlanId!, 1)).bookable).toBe(true)
  })

  // The hair has to have had the six weeks — booked is not the same as done.
  it('session two waits until session one has actually been completed', async () => {
    const { id } = await consultFor(['sp_bal'], { goal: 9, boxdye: true })
    const { servicePlanId } = await reviewConsultation({
      salonId: S,
      consultationId: id,
      reviewerUserId: 'sp_user',
      decision: 'APPROVE',
    })

    const result = await sessionBookability(S, servicePlanId!, 2)
    expect(result.bookable).toBe(false)
    expect(result.reason).toMatch(/has not happened yet/)
  })

  it('an outstanding pre-requirement blocks booking entirely', async () => {
    const { id } = await consultFor(['sp_cut'], { goal: 6, boxdye: false })
    const { servicePlanId } = await reviewConsultation({
      salonId: S,
      consultationId: id,
      reviewerUserId: 'sp_user',
      decision: 'APPROVE',
    })

    await unsafeDb.preRequirement.create({
      data: {
        salonId: S,
        servicePlanId: servicePlanId!,
        kind: 'PATCH_TEST',
        dueBefore: 'BOOKING',
        rationale: 'A patch test is required at least 48 hours beforehand.',
        status: 'PENDING',
      },
    })

    const result = await sessionBookability(S, servicePlanId!, 1)
    expect(result.bookable).toBe(false)
    expect(result.reason).toMatch(/patch test/i)
  })
})
