import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import type { EvaluationResult } from '@/domain/consultation/types'
import { consultationPhotos, inspirationPhotos } from './photos'

/**
 * The stylist review queue.
 *
 * This is where the product's promise is actually kept: a person looks at what
 * the engine concluded and either agrees or corrects it. The queue's job is to
 * make that fast enough to happen every day — a review workspace that takes ten
 * minutes per consultation is a review workspace a salon stops using, and a
 * salon that stops reviewing is back to booking on a guess.
 *
 * So the ordering is by urgency, not arrival: something with a hard deadline
 * or an approaching SLA outranks something submitted first.
 */

export type QueueFilter = 'WAITING' | 'MINE' | 'OVERDUE' | 'ALL'

export interface QueueItem {
  id: string
  clientName: string
  clientIsNew: boolean
  serviceNames: string[]
  submittedAt: Date | null
  slaDueAt: Date | null
  overdue: boolean
  hoursLeft: number | null
  maxSeverity: string
  flagCount: number
  blocksOnlineBooking: boolean
  complexityBand: string
  estimatedTotalCents: number
  sessionCount: number
  requestedStylistId: string | null
  requestedStylistName: string | null
  recommendedDecision: string
}

const OPEN_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'NEEDS_MORE_INFO'] as const

export async function reviewQueue(
  salonId: string,
  opts: { filter?: QueueFilter; stylistProfileId?: string | null } = {},
): Promise<QueueItem[]> {
  const filter = opts.filter ?? 'WAITING'
  const now = new Date()

  const consultations = await unsafeDb.consultation.findMany({
    where: {
      salonId,
      status: { in: [...OPEN_STATUSES] },
      ...(filter === 'MINE' && opts.stylistProfileId
        ? { requestedStylistId: opts.stylistProfileId }
        : {}),
      ...(filter === 'OVERDUE' ? { slaDueAt: { lt: now } } : {}),
    },
    orderBy: { submittedAt: 'asc' },
    take: 200,
    select: {
      id: true,
      status: true,
      submittedAt: true,
      slaDueAt: true,
      requestedServiceIds: true,
      requestedStylistId: true,
      latestEvaluationId: true,
      clientProfile: {
        select: { firstName: true, lastName: true, completedVisits: true },
      },
    },
  })

  const [evaluations, services, stylists] = await Promise.all([
    unsafeDb.ruleEvaluation.findMany({
      where: {
        id: {
          in: consultations.map((c) => c.latestEvaluationId).filter((id): id is string => !!id),
        },
      },
      select: { id: true, outputSnapshotJson: true },
    }),
    unsafeDb.service.findMany({
      where: { salonId, id: { in: consultations.flatMap((c) => c.requestedServiceIds) } },
      select: { id: true, name: true },
    }),
    // requestedStylistId is a plain column, not a relation — the consultation
    // deliberately does not depend on the stylist row still existing.
    unsafeDb.stylistProfile.findMany({
      where: { salonId },
      select: { id: true, displayName: true },
    }),
  ])

  const byId = new Map(
    evaluations.map((e) => [e.id, e.outputSnapshotJson as unknown as EvaluationResult]),
  )
  const serviceNames = new Map(services.map((s) => [s.id, s.name]))
  const stylistNames = new Map(stylists.map((s) => [s.id, s.displayName]))

  const items = consultations.map((consultation): QueueItem => {
    const evaluation = consultation.latestEvaluationId
      ? byId.get(consultation.latestEvaluationId)
      : undefined

    const hoursLeft = consultation.slaDueAt
      ? (consultation.slaDueAt.getTime() - now.getTime()) / 3_600_000
      : null

    return {
      id: consultation.id,
      clientName:
        `${consultation.clientProfile.firstName} ${consultation.clientProfile.lastName ?? ''}`.trim(),
      clientIsNew: consultation.clientProfile.completedVisits === 0,
      serviceNames: consultation.requestedServiceIds.map((id) => serviceNames.get(id) ?? 'Service'),
      submittedAt: consultation.submittedAt,
      slaDueAt: consultation.slaDueAt,
      overdue: hoursLeft !== null && hoursLeft < 0,
      hoursLeft,
      maxSeverity: evaluation?.maxSeverity ?? 'NONE',
      flagCount: evaluation?.flags.length ?? 0,
      blocksOnlineBooking: evaluation?.blocksOnlineBooking ?? false,
      complexityBand: evaluation?.complexity.band ?? 'SIMPLE',
      estimatedTotalCents: evaluation?.price.estimatedTotalCents ?? 0,
      sessionCount: evaluation?.plan.sessionCount ?? 1,
      requestedStylistId: consultation.requestedStylistId,
      requestedStylistName: consultation.requestedStylistId
        ? (stylistNames.get(consultation.requestedStylistId) ?? null)
        : null,
      recommendedDecision: evaluation?.recommendedDecision ?? 'STYLIST_REVIEW',
    }
  })

  return items.sort(byUrgency)
}

const SEVERITY_RANK: Record<string, number> = { BLOCKER: 0, HIGH: 1, CAUTION: 2, INFO: 3, NONE: 4 }

/**
 * Most urgent first.
 *
 * Overdue outranks everything — an SLA a salon publishes and then misses is
 * worse than not publishing one. After that, severity, because a blocker
 * sitting in a queue is a client who cannot book at all. Only then arrival
 * order, which is what a naive queue would have used for everything.
 */
function byUrgency(a: QueueItem, b: QueueItem): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
  if (a.blocksOnlineBooking !== b.blocksOnlineBooking) return a.blocksOnlineBooking ? -1 : 1

  const severity = (SEVERITY_RANK[a.maxSeverity] ?? 9) - (SEVERITY_RANK[b.maxSeverity] ?? 9)
  if (severity !== 0) return severity

  if (a.hoursLeft !== null && b.hoursLeft !== null && a.hoursLeft !== b.hoursLeft) {
    return a.hoursLeft - b.hoursLeft
  }
  return (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0)
}

/**
 * Everything the review screen needs, in one call.
 *
 * A stylist reviewing a consultation needs the client's answers, their photos,
 * what they said about their inspiration, their history, and the engine's
 * reasoning — all at once. Assembling that from six round trips is how the
 * screen ends up feeling slow enough to avoid.
 */
export async function reviewDetail(salonId: string, consultationId: string) {
  const consultation = await unsafeDb.consultation.findFirst({
    where: { id: consultationId, salonId },
    include: {
      answers: true,
      template: { include: { questions: { orderBy: { sortOrder: 'asc' } } } },
      clientProfile: {
        include: {
          hairProfile: true,
          _count: { select: { appointments: true } },
        },
      },
      reviews: { orderBy: { decidedAt: 'desc' }, take: 5 },
      servicePlan: { select: { id: true, status: true } },
    },
  })
  if (!consultation) throw new DomainError('NOT_FOUND', 'That consultation no longer exists.')

  const [services, photos, inspiration, flags, evaluationRow, priorVisits] = await Promise.all([
    unsafeDb.service.findMany({
      where: { salonId, id: { in: consultation.requestedServiceIds } },
      include: { phases: { orderBy: { sequence: 'asc' } } },
    }),
    consultationPhotos(salonId, consultationId),
    inspirationPhotos(salonId, consultationId),
    unsafeDb.riskFlag.findMany({
      where: { salonId, consultationId },
      orderBy: { severity: 'asc' },
    }),
    consultation.latestEvaluationId
      ? unsafeDb.ruleEvaluation.findUnique({
          where: { id: consultation.latestEvaluationId },
          select: { id: true, outputSnapshotJson: true, rulesetVersion: true, createdAt: true },
        })
      : null,
    // What actually happened last time beats any estimate.
    unsafeDb.appointment.findMany({
      where: {
        salonId,
        clientProfileId: consultation.clientProfileId,
        status: 'COMPLETED',
      },
      orderBy: { startsAt: 'desc' },
      take: 5,
      include: {
        primaryStylist: { select: { displayName: true } },
        services: { include: { service: { select: { name: true } } } },
      },
    }),
  ])

  const answers = new Map(consultation.answers.map((a) => [a.questionKey, a.valueJson]))

  return {
    consultation,
    services,
    photos,
    inspiration,
    flags,
    priorVisits,
    evaluation: (evaluationRow?.outputSnapshotJson as EvaluationResult | undefined) ?? null,
    evaluationMeta: evaluationRow
      ? {
          id: evaluationRow.id,
          rulesetVersion: evaluationRow.rulesetVersion,
          at: evaluationRow.createdAt,
        }
      : null,
    // Questions with their answers, in the order the client saw them.
    answered: consultation.template.questions.map((question) => ({
      key: question.key,
      section: question.section,
      prompt: question.prompt,
      inputType: question.inputType,
      answer: answers.get(question.key) ?? null,
      wasAnswered: answers.has(question.key),
    })),
  }
}

/** Claim a consultation so two stylists do not review the same one. */
export async function claimForReview(
  salonId: string,
  consultationId: string,
  stylistProfileId: string | null,
): Promise<void> {
  await unsafeDb.consultation.updateMany({
    where: { id: consultationId, salonId, status: 'SUBMITTED' },
    data: {
      status: 'IN_REVIEW',
      ...(stylistProfileId ? { requestedStylistId: stylistProfileId } : {}),
    },
  })
}

/**
 * Record a stylist's judgement on a single flag.
 *
 * Overriding a blocker is a deliberate, named, reasoned act — it is the one
 * place a person overrules the engine on safety, and the record of who did it
 * and why is the point.
 */
export async function resolveFlag(input: {
  salonId: string
  flagId: string
  status: 'ACKNOWLEDGED' | 'OVERRIDDEN' | 'RESOLVED'
  userId: string
  reason?: string | null
}): Promise<void> {
  const flag = await unsafeDb.riskFlag.findFirst({
    where: { id: input.flagId, salonId: input.salonId },
    select: { id: true, blocksOnlineBooking: true, severity: true },
  })
  if (!flag) throw new DomainError('NOT_FOUND', 'That flag no longer exists.')

  if (input.status === 'OVERRIDDEN' && !input.reason?.trim()) {
    throw new DomainError(
      'REASON_REQUIRED',
      'Overriding a risk flag needs a written reason — it goes on the record.',
    )
  }

  await unsafeDb.riskFlag.update({
    where: { id: flag.id },
    data: {
      status: input.status,
      ...(input.status === 'OVERRIDDEN'
        ? {
            overriddenByUserId: input.userId,
            overrideReason: input.reason ?? null,
            overriddenAt: new Date(),
          }
        : {}),
    },
  })
}

/** How the queue is doing, for the header and the owner's dashboard. */
export async function queueStats(salonId: string) {
  const now = new Date()

  const [waiting, overdue, blocked] = await Promise.all([
    unsafeDb.consultation.count({ where: { salonId, status: { in: [...OPEN_STATUSES] } } }),
    unsafeDb.consultation.count({
      where: { salonId, status: { in: [...OPEN_STATUSES] }, slaDueAt: { lt: now } },
    }),
    unsafeDb.riskFlag.count({
      where: { salonId, status: 'OPEN', blocksOnlineBooking: true },
    }),
  ])

  return { waiting, overdue, blocked }
}
