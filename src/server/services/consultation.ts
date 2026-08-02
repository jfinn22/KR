import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import { evaluate } from '@/domain/consultation/engine'
import { getRuleset, DEFAULT_RULESET_VERSION } from '@/domain/consultation/registry'
import { normalizeFacts } from '@/domain/consultation/normalize'
import { buildSteps, completionRatio, missingRequired } from '@/domain/consultation/visibility'
import { requiredPhotoViews, suggestedPhotoViews } from '@/domain/consultation/photos'
import type { EvaluationResult } from '@/domain/consultation/types'
import type { ServiceFactSpec } from '@/domain/consultation/facts'

/**
 * The consultation lifecycle.
 *
 * This is where the database meets the rules engine. It reads rows, hands the
 * pure engine a frozen fact snapshot, and writes the result back as an
 * immutable `RuleEvaluation` plus the flags and plan derived from it.
 *
 * Re-evaluating never mutates a past evaluation — it inserts a new one and
 * repoints `latestEvaluationId`. That is what keeps a stylist's approval
 * attached to exactly the inputs and outputs they saw.
 */

export interface ConsultationQuestionView {
  key: string
  section: string
  sortOrder: number
  isRequired: boolean
  visibleWhenJson: unknown
  prompt: string
  helpText: string | null
  inputType: string
  optionsJson: unknown
}

export interface ConsultationView {
  id: string
  status: string
  /**
   * The full question set, including ones currently hidden by a condition.
   *
   * The guided flow re-derives visibility as the client answers, so it needs
   * every question rather than the subset visible at page load — otherwise
   * ticking "yes, box dye" would require a round trip before the follow-up
   * could appear.
   */
  questions: ConsultationQuestionView[]
  steps: ReturnType<typeof buildSteps>
  answers: Record<string, unknown>
  completion: number
  missing: string[]
  requiredPhotoViews: readonly string[]
  suggestedPhotoViews: readonly string[]
  providedPhotoViews: string[]
  evaluation: EvaluationResult | null
}

/** Turn a catalog row into the frozen spec the engine reasons about. */
function toServiceSpec(service: {
  id: string
  name: string
  isChemical: boolean
  isLightening: boolean
  containsDye: boolean
  isExtensionInstall: boolean
  baseComplexity: number
  basePriceCents: number
  requiredSkillCode: string | null
  requiredSkillLevel: number | null
  phases: { kind: string; label: string; durationMin: number; isScalable: boolean }[]
}): ServiceFactSpec {
  return {
    serviceId: service.id,
    name: service.name,
    isChemical: service.isChemical,
    isLightening: service.isLightening,
    containsDye: service.containsDye,
    isExtensionInstall: service.isExtensionInstall,
    baseComplexity: service.baseComplexity,
    basePriceCents: service.basePriceCents,
    requiredSkillCode: service.requiredSkillCode,
    requiredSkillLevel: service.requiredSkillLevel,
    phases: service.phases.map((p) => ({
      kind: p.kind as ServiceFactSpec['phases'][number]['kind'],
      label: p.label,
      durationMin: p.durationMin,
      isScalable: p.isScalable,
    })),
  }
}

export async function startConsultation(input: {
  salonId: string
  clientProfileId: string
  serviceIds: string[]
  stylistProfileId?: string | null
  templateKey?: string
}): Promise<string> {
  const template = await unsafeDb.consultationTemplate.findFirst({
    where: {
      status: 'PUBLISHED',
      OR: [{ salonId: input.salonId }, { salonId: null }],
      ...(input.templateKey ? { key: input.templateKey } : {}),
    },
    orderBy: [{ salonId: 'desc' }, { version: 'desc' }],
  })
  if (!template) {
    throw new DomainError('NOT_FOUND', 'This salon has no published consultation form yet.')
  }

  const settings = await unsafeDb.salonSettings.findUnique({ where: { salonId: input.salonId } })
  const expiryDays = settings?.consultationExpiryDays ?? 60

  const consultation = await unsafeDb.consultation.create({
    data: {
      salonId: input.salonId,
      clientProfileId: input.clientProfileId,
      templateId: template.id,
      templateVersion: template.version,
      requestedServiceIds: input.serviceIds,
      requestedStylistId: input.stylistProfileId ?? null,
      status: 'DRAFT',
      expiresAt: new Date(Date.now() + expiryDays * 86_400_000),
    },
  })

  return consultation.id
}

/** Save one answer. Called on every change so a client never loses progress. */
export async function saveAnswer(input: {
  salonId: string
  consultationId: string
  questionKey: string
  value: unknown
}): Promise<void> {
  const consultation = await unsafeDb.consultation.findFirst({
    where: { id: input.consultationId, salonId: input.salonId },
    select: { id: true, status: true, templateId: true },
  })
  if (!consultation) throw new DomainError('NOT_FOUND', 'That consultation no longer exists.')
  if (consultation.status !== 'DRAFT' && consultation.status !== 'NEEDS_MORE_INFO') {
    throw new DomainError('CONFLICT', 'This consultation has been submitted and cannot be edited.')
  }

  const question = await unsafeDb.consultationQuestion.findFirst({
    where: { templateId: consultation.templateId, key: input.questionKey },
    select: { id: true },
  })
  if (!question) throw new DomainError('INVALID_INPUT', 'Unknown question.')

  await unsafeDb.consultationAnswer.upsert({
    where: {
      consultationId_questionKey: {
        consultationId: consultation.id,
        questionKey: input.questionKey,
      },
    },
    create: {
      salonId: input.salonId,
      consultationId: consultation.id,
      questionId: question.id,
      questionKey: input.questionKey,
      valueJson: input.value as never,
    },
    update: { valueJson: input.value as never, answeredAt: new Date() },
  })
}

/** Everything the guided flow needs to render, in one query set. */
export async function loadConsultation(
  salonId: string,
  consultationId: string,
): Promise<ConsultationView> {
  const consultation = await unsafeDb.consultation.findFirst({
    where: { id: consultationId, salonId },
    include: {
      answers: true,
      photos: { select: { view: true } },
      template: { include: { questions: { orderBy: { sortOrder: 'asc' } } } },
    },
  })
  if (!consultation) throw new DomainError('NOT_FOUND', 'That consultation no longer exists.')

  const answers: Record<string, unknown> = {}
  for (const answer of consultation.answers) answers[answer.questionKey] = answer.valueJson

  const questions: ConsultationQuestionView[] = consultation.template.questions.map((q) => ({
    key: q.key,
    section: q.section,
    sortOrder: q.sortOrder,
    isRequired: q.isRequired,
    visibleWhenJson: q.visibleWhenJson,
    prompt: q.prompt,
    helpText: q.helpText,
    inputType: q.inputType,
    optionsJson: q.optionsJson,
  }))

  let evaluation: EvaluationResult | null = null
  if (consultation.latestEvaluationId) {
    const row = await unsafeDb.ruleEvaluation.findUnique({
      where: { id: consultation.latestEvaluationId },
      select: { outputSnapshotJson: true },
    })
    evaluation = (row?.outputSnapshotJson as EvaluationResult | undefined) ?? null
  }

  const services = await unsafeDb.service.findMany({
    where: { salonId, id: { in: consultation.requestedServiceIds } },
    select: {
      isChemical: true,
      isLightening: true,
      containsDye: true,
      isExtensionInstall: true,
    },
  })

  return {
    id: consultation.id,
    status: consultation.status,
    questions,
    steps: buildSteps(questions, answers),
    answers,
    completion: completionRatio(questions, answers),
    missing: missingRequired(questions, answers).map((q) => q.key),
    requiredPhotoViews: requiredPhotoViews(services),
    suggestedPhotoViews: suggestedPhotoViews(services),
    providedPhotoViews: consultation.photos.map((p) => p.view),
    evaluation,
  }
}

/**
 * Run the rules engine and persist the result.
 *
 * Always inserts a new `RuleEvaluation`. Callers get the result back so they can
 * render it without a second read.
 */
export async function evaluateConsultation(input: {
  salonId: string
  consultationId: string
  trigger?: 'SUBMIT' | 'RE_EVALUATE' | 'FACT_ACCEPTED' | 'STAFF_EDIT' | 'REPLAY'
  actorUserId?: string | null
  now?: Date
}): Promise<EvaluationResult> {
  const now = input.now ?? new Date()

  const consultation = await unsafeDb.consultation.findFirst({
    where: { id: input.consultationId, salonId: input.salonId },
    include: {
      answers: true,
      photos: { select: { view: true, qualityScore: true } },
      template: { include: { questions: { select: { key: true, factKey: true } } } },
      clientProfile: {
        select: {
          id: true,
          dateOfBirth: true,
          noShowCount: true,
          completedVisits: true,
          hairProfile: true,
        },
      },
    },
  })
  if (!consultation) throw new DomainError('NOT_FOUND', 'That consultation no longer exists.')

  const services = await unsafeDb.service.findMany({
    where: { salonId: input.salonId, id: { in: consultation.requestedServiceIds } },
    include: { phases: { orderBy: { sequence: 'asc' } } },
  })
  if (services.length === 0) {
    throw new DomainError('INVALID_INPUT', 'This consultation has no service attached.')
  }

  // Stylist skills and pace are DATA the engine receives, never a lookup it
  // performs — that is what keeps it pure and replayable.
  let stylistSkills: Record<string, number> = {}
  let durationFactor = 1
  let calibrationSamples = 0

  if (consultation.requestedStylistId) {
    const [skills, calibration] = await Promise.all([
      unsafeDb.stylistSkill.findMany({
        where: { stylistProfileId: consultation.requestedStylistId },
        select: { skillCode: true, level: true },
      }),
      unsafeDb.stylistCalibration.findFirst({
        where: { stylistProfileId: consultation.requestedStylistId, serviceId: null },
      }),
    ])
    stylistSkills = Object.fromEntries(skills.map((s) => [s.skillCode, s.level]))
    if (calibration) {
      durationFactor = Number(calibration.manualOverride ?? calibration.shrunkFactor)
      calibrationSamples = calibration.sampleCount
    }
  }

  const patchTest = await unsafeDb.patchTest.findFirst({
    where: {
      clientProfileId: consultation.clientProfileId,
      result: 'NEGATIVE',
      validUntil: { gt: now },
    },
    orderBy: { validUntil: 'desc' },
  })

  const guardianConsent = await unsafeDb.consentGrant.findFirst({
    where: {
      clientProfileId: consultation.clientProfileId,
      kind: 'MINOR_GUARDIAN',
      status: 'GRANTED',
    },
  })

  const answers: Record<string, unknown> = {}
  for (const answer of consultation.answers) answers[answer.questionKey] = answer.valueJson

  const factKeys: Record<string, string> = {}
  for (const question of consultation.template.questions) {
    if (question.factKey) factKeys[question.key] = question.factKey
  }

  const dateOfBirth = consultation.clientProfile.dateOfBirth
  const isMinor = dateOfBirth
    ? (now.getTime() - dateOfBirth.getTime()) / (365.25 * 86_400_000) < 18
    : false

  const facts = normalizeFacts({
    answers,
    factKeys,
    hairProfile: consultation.clientProfile.hairProfile,
    client: {
      // Pseudonymous by construction: the engine never sees a name.
      ref: consultation.clientProfileId,
      isMinor,
      isNewToSalon: consultation.clientProfile.completedVisits === 0,
      priorNoShows: consultation.clientProfile.noShowCount,
      priorCompletedVisits: consultation.clientProfile.completedVisits,
    },
    services: services.map(toServiceSpec),
    stylist: {
      ref: consultation.requestedStylistId,
      skills: stylistSkills,
      durationFactor,
      calibrationSamples,
    },
    compliance: {
      validPatchTestDaysRemaining: patchTest
        ? Math.ceil((patchTest.validUntil.getTime() - now.getTime()) / 86_400_000)
        : null,
      guardianConsentOnFile: Boolean(guardianConsent),
    },
    photos: {
      providedViews: consultation.photos.map((p) => p.view),
      // Scaled to the basket: a dry cut is not held up waiting for root shots.
      requiredViews: requiredPhotoViews(services),
      lowestQualityScore: consultation.photos.length
        ? Math.min(...consultation.photos.map((p) => Number(p.qualityScore ?? 1)))
        : null,
    },
    today: now,
  })

  // A salon may switch a rule off, but may never author new logic.
  const disabled = await unsafeDb.salonRuleOverride.findMany({
    where: { salonId: input.salonId, isEnabled: false },
    select: { ruleId: true },
  })

  const pin = await unsafeDb.salonRulesetPin.findUnique({ where: { salonId: input.salonId } })
  const ruleset = getRuleset(pin?.rulesetVersion ?? DEFAULT_RULESET_VERSION)

  const started = Date.now()
  const result = evaluate({
    facts,
    ruleset,
    today: now.toISOString().slice(0, 10),
    disabledRuleIds: new Set(disabled.map((d) => d.ruleId)),
  })

  await unsafeDb.$transaction(async (tx) => {
    const evaluation = await tx.ruleEvaluation.create({
      data: {
        salonId: input.salonId,
        consultationId: consultation.id,
        rulesetVersion: result.rulesetVersion,
        rulesetHash: result.rulesetHash,
        inputHash: result.inputHash,
        inputSnapshotJson: facts as never,
        outputSnapshotJson: result as never,
        engineMs: Date.now() - started,
        triggeredBy: input.trigger ?? 'SUBMIT',
        createdByUserId: input.actorUserId ?? null,
      },
    })

    // Flags belong to the evaluation that produced them; a fresh run replaces
    // the open set rather than accumulating duplicates across re-evaluations.
    await tx.riskFlag.deleteMany({
      where: { consultationId: consultation.id, status: 'OPEN' },
    })

    for (const flag of result.flags) {
      await tx.riskFlag.create({
        data: {
          salonId: input.salonId,
          consultationId: consultation.id,
          evaluationId: evaluation.id,
          ruleId: flag.ruleId,
          ruleVersion: flag.ruleVersion,
          code: flag.code,
          severity: flag.severity,
          title: flag.title,
          detail: flag.detail,
          evidenceJson: flag.evidence as never,
          recommendedPath: flag.recommendedPath,
          blocksOnlineBooking: flag.blocksOnlineBooking,
        },
      })
    }

    await tx.preRequirement.deleteMany({
      where: { consultationId: consultation.id, status: 'PENDING' },
    })

    for (const requirement of result.requirements) {
      await tx.preRequirement.create({
        data: {
          salonId: input.salonId,
          consultationId: consultation.id,
          kind: requirement.kind,
          dueBefore: requirement.dueBefore,
          sessionSequence: requirement.sessionSequence,
          leadHours: requirement.leadHours,
          formTemplateKey: requirement.formTemplateKey,
          rationale: requirement.rationale,
        },
      })
    }

    await tx.consultation.update({
      where: { id: consultation.id },
      data: {
        rulesetVersion: result.rulesetVersion,
        latestEvaluationId: evaluation.id,
        factsSnapshotJson: facts as never,
        mode: result.mode,
      },
    })
  })

  return result
}

/** Submit for review. Refuses while required questions are unanswered. */
export async function submitConsultation(input: {
  salonId: string
  consultationId: string
  clientNote?: string | null
}): Promise<EvaluationResult> {
  const view = await loadConsultation(input.salonId, input.consultationId)

  if (view.missing.length > 0) {
    throw new DomainError(
      'INVALID_INPUT',
      `Please answer ${view.missing.length} more question${view.missing.length === 1 ? '' : 's'} before submitting.`,
    )
  }

  const settings = await unsafeDb.salonSettings.findUnique({ where: { salonId: input.salonId } })
  const slaHours = settings?.consultationSlaHours ?? 24

  await unsafeDb.consultation.update({
    where: { id: input.consultationId },
    data: {
      status: 'SUBMITTED',
      submittedAt: new Date(),
      slaDueAt: new Date(Date.now() + slaHours * 3_600_000),
      clientNote: input.clientNote ?? null,
    },
  })

  return evaluateConsultation({ ...input, trigger: 'SUBMIT' })
}
