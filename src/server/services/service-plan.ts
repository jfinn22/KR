import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import { buildChain, chainDuration } from '@/domain/scheduling/chain'
import { isNarrowed, type BookingWindow } from '@/domain/scheduling/window'
import { quoteDeposit } from './commerce'
import type { EvaluationResult } from '@/domain/consultation/types'
import { capableStylists, getServices, toChainSpec } from './catalog'
import { schedulingSettingsFrom } from './scheduling/loader'

/**
 * Turning an approved consultation into a bookable plan.
 *
 * The important thing this does is FREEZE. Each session stores the phase chain
 * as it stood at approval, so a salon editing a service next month cannot
 * silently change the shape of an appointment somebody already booked — the
 * client agreed to four hours and four hours is what they get.
 *
 * Section B's review workspace calls this with a human decision. It is also
 * called automatically for services the engine judged simple and unflagged,
 * when the salon has opted into that.
 */

export type ReviewDecision =
  | 'APPROVE'
  | 'APPROVE_WITH_CHANGES'
  | 'REQUEST_IN_PERSON'
  | 'REQUEST_MORE_PHOTOS'
  | 'REQUEST_MORE_INFO'
  | 'DECLINE'

export interface ApproveInput {
  salonId: string
  consultationId: string
  reviewerUserId: string | null
  decision: ReviewDecision
  /** A stylist's judgement beats the estimate; both are recorded. */
  overrides?: {
    durationMin?: number | null
    priceCents?: number | null
    depositCents?: number | null
    stylistProfileId?: string | null
    /**
     * Days and times to hold this to. Availability stays auto-computed — this
     * only removes from what the solver would have offered, never adds, so a
     * narrowing can never conjure a slot the diary does not have.
     */
    window?: BookingWindow | null
  }
  notesInternal?: string | null
  notesToClient?: string | null
  /** True when this came from auto-approval rather than a person. */
  automatic?: boolean
}

/**
 * The window as five columns.
 *
 * Written as a spread rather than five conditionals so an approval that
 * narrows nothing writes nothing, and the schema defaults — wide open — stand.
 */
function windowColumns(window: BookingWindow | null | undefined) {
  if (!window || !isNarrowed(window)) return {}
  return {
    windowEarliestDate: window.earliestDate ? new Date(`${window.earliestDate}T00:00:00Z`) : null,
    windowLatestDate: window.latestDate ? new Date(`${window.latestDate}T00:00:00Z`) : null,
    dayOfWeekMask: window.dayOfWeekMask,
    windowStartMinute: window.windowStartMinute,
    windowEndMinute: window.windowEndMinute,
  }
}

const DECISION_TO_STATUS: Record<ReviewDecision, string> = {
  APPROVE: 'APPROVED',
  APPROVE_WITH_CHANGES: 'APPROVED',
  REQUEST_IN_PERSON: 'NEEDS_IN_PERSON',
  REQUEST_MORE_PHOTOS: 'NEEDS_MORE_INFO',
  REQUEST_MORE_INFO: 'NEEDS_MORE_INFO',
  DECLINE: 'DECLINED',
}

export async function reviewConsultation(
  input: ApproveInput,
): Promise<{ status: string; servicePlanId: string | null }> {
  const consultation = await unsafeDb.consultation.findFirst({
    where: { id: input.consultationId, salonId: input.salonId },
    select: {
      id: true,
      status: true,
      clientProfileId: true,
      requestedServiceIds: true,
      requestedStylistId: true,
      latestEvaluationId: true,
      rulesetVersion: true,
    },
  })
  if (!consultation) throw new DomainError('NOT_FOUND', 'That consultation no longer exists.')
  if (consultation.status === 'APPROVED') {
    throw new DomainError('CONFLICT', 'This consultation has already been approved.')
  }
  if (!consultation.latestEvaluationId) {
    throw new DomainError('CONFLICT', 'This consultation has not been evaluated yet.')
  }

  const evaluationRow = await unsafeDb.ruleEvaluation.findUnique({
    where: { id: consultation.latestEvaluationId },
    select: { id: true, outputSnapshotJson: true },
  })
  const evaluation = evaluationRow?.outputSnapshotJson as EvaluationResult | undefined
  if (!evaluationRow || !evaluation) {
    throw new DomainError('CONFLICT', 'That evaluation is no longer available.')
  }

  const status = DECISION_TO_STATUS[input.decision]!

  // Anything other than an approval just records the decision and sends the
  // client back round — no plan is created.
  if (status !== 'APPROVED') {
    /*
     * "Come in and let me look at it" needs somebody to come in TO.
     *
     * `REQUEST_IN_PERSON` set a status and stopped, so the stylist's judgement
     * that they needed to see the hair went into a column and died there. The
     * client can now book thirty minutes — but only if there is a stylist
     * pinned to book with, and `requestedStylistId` is nullable because
     * "anyone who can do it" is the normal way to book online.
     *
     * The reviewer wins, then whoever the client asked for, then whoever asked
     * to see them. Falling back to a capable stylist keeps the invitation
     * bookable rather than leaving it stranded.
     */
    const inPersonStylistId =
      input.decision === 'REQUEST_IN_PERSON'
        ? (input.overrides?.stylistProfileId ??
          consultation.requestedStylistId ??
          (await reviewerStylistId(input.salonId, input.reviewerUserId)) ??
          (await assignCapableStylist(input.salonId, consultation.requestedServiceIds)))
        : null

    await unsafeDb.$transaction([
      unsafeDb.consultationReview.create({
        data: {
          salonId: input.salonId,
          consultationId: consultation.id,
          reviewerUserId: input.reviewerUserId ?? 'system',
          decision: input.decision,
          notesInternal: input.notesInternal ?? null,
          notesToClient: input.notesToClient ?? null,
        },
      }),
      unsafeDb.consultation.update({
        where: { id: consultation.id },
        data: {
          status: status as never,
          reviewedAt: new Date(),
          ...(inPersonStylistId ? { requestedStylistId: inPersonStylistId } : {}),
        },
      }),
    ])
    return { status, servicePlanId: null }
  }

  /*
   * A plan is always attached to a stylist, but the client is not required to
   * have chosen one — "anyone who can do it" is the normal way to book online,
   * and refusing to approve without a name would block the entire self-serve
   * path. Where nobody was requested, assign someone capable of every service
   * in the basket; the booking screen still lets the client widen back out to
   * anyone, so this is a starting point rather than a commitment.
   */
  const stylistId =
    input.overrides?.stylistProfileId ??
    consultation.requestedStylistId ??
    (await assignCapableStylist(input.salonId, consultation.requestedServiceIds))

  if (!stylistId) {
    throw new DomainError(
      'CONFLICT',
      'Nobody on the team is currently set up to do all of these services together.',
    )
  }

  const [services, settings] = await Promise.all([
    getServices(input.salonId, consultation.requestedServiceIds),
    unsafeDb.salonSettings.findUnique({ where: { salonId: input.salonId } }),
  ])

  const schedulingSettings = schedulingSettingsFrom(settings)

  const chainSpecs = services.map((service) =>
    toChainSpec(service, {
      bufferBeforeMin: settings?.defaultBufferBeforeMin ?? 0,
      bufferAfterMin: settings?.defaultBufferAfterMin ?? 10,
    }),
  )

  // Scale the whole chain so the frozen sessions reflect the engine's estimate
  // — including any duration the risk rules added — rather than the raw catalog.
  const rawMinutes = chainSpecs.reduce(
    (sum, spec) => sum + spec.phases.reduce((a, p) => a + p.durationMin, 0),
    0,
  )
  const scalableFactor = rawMinutes > 0 ? evaluation.duration.totalMin / rawMinutes : 1

  const totalMin = input.overrides?.durationMin ?? evaluation.duration.totalMin
  const totalCents = input.overrides?.priceCents ?? evaluation.price.estimatedTotalCents

  /*
   * The deposit comes from commerce, not from the engine.
   *
   * The engine still decides how risky this is — that is what it is for — but
   * it no longer decides what that risk costs. It used to, from percentages
   * hardcoded in `engine.ts` that no salon had ever seen, while the till
   * computed a different figure from the salon's own policy row. The client
   * was quoted one and asked for the other, and the two were never compared
   * because nothing mapped the engine's 0–3 band onto the till's named one.
   *
   * This must be settled before any deposit is really charged: the figure is
   * frozen onto the plan and every session below, so moving the authority
   * later is a migration over live plans somebody has already agreed to.
   */
  const quoted = await quoteDeposit({
    salonId: input.salonId,
    serviceIds: consultation.requestedServiceIds,
    band: evaluation.deposit.band,
    serviceTotalCents: totalCents,
  })
  const depositCents = input.overrides?.depositCents ?? quoted.amountCents

  const planValidityDays = settings?.planValidityDays ?? 90

  const servicePlanId = await unsafeDb.$transaction(async (tx) => {
    const plan = await tx.servicePlan.create({
      data: {
        salonId: input.salonId,
        consultationId: consultation.id,
        clientProfileId: consultation.clientProfileId,
        stylistProfileId: stylistId,
        status: 'APPROVED',
        totalSessions: evaluation.plan.sessionCount,
        complexityScore: evaluation.complexity.score,
        riskLevel: evaluation.maxSeverity === 'NONE' ? 'INFO' : evaluation.maxSeverity,
        estimatedTotalMin: totalMin,
        estimatedTotalCents: totalCents,
        depositCents,
        // What decided it, not merely what it came to — so "why £50?" has an
        // answer a year later, after the policy has been edited twice.
        depositPolicySnapshotJson: {
          band: evaluation.deposit.band,
          ...quoted,
        } as never,
        rulesetVersion: evaluation.rulesetVersion,
        evaluationId: evaluationRow.id,
        // Multi-session correction should stay with one pair of hands.
        requiresStylistContinuity: evaluation.plan.sessionCount > 1,
        ...windowColumns(input.overrides?.window),
        notesToClient: input.notesToClient ?? evaluation.plan.rationale,
        approvedByUserId: input.reviewerUserId,
        approvedAt: new Date(),
        validUntil: new Date(Date.now() + planValidityDays * 86_400_000),
      },
    })

    for (const session of evaluation.plan.sessions) {
      const created = await tx.servicePlanSession.create({
        data: {
          salonId: input.salonId,
          servicePlanId: plan.id,
          sequence: session.sequence,
          name: session.label,
          estimatedDurationMin: session.estimatedDurationMin,
          estimatedPriceCents: session.estimatedPriceCents,
          depositCents: session.sequence === 1 ? depositCents : 0,
          minDaysAfterPrevious: session.minDaysAfterPrevious,
          maxDaysAfterPrevious: session.maxDaysAfterPrevious,
          status: 'PLANNED',
        },
      })

      // Freeze the chain. This is the line that stops a later catalog edit
      // changing an appointment a client already agreed to.
      const share = session.estimatedDurationMin / Math.max(totalMin, 1)
      for (const [index, service] of services.entries()) {
        const chain = buildChain([chainSpecs[index]!], {
          settings: schedulingSettings,
          scalableFactor: scalableFactor * (evaluation.plan.sessionCount > 1 ? share : 1),
        })

        await tx.servicePlanSessionService.create({
          data: {
            salonId: input.salonId,
            sessionId: created.id,
            serviceId: service.id,
            sequence: index,
            plannedDurationMin: chainDuration(chain),
            plannedPriceCents: Math.round(service.basePriceCents * (share || 1)),
            phaseChainJson: chain as never,
          },
        })
      }
    }

    await tx.consultationReview.create({
      data: {
        salonId: input.salonId,
        consultationId: consultation.id,
        reviewerUserId: input.reviewerUserId ?? 'system',
        decision: input.decision,
        notesInternal: input.automatic
          ? 'Auto-approved: simple service, no risk flags, salon opted in.'
          : (input.notesInternal ?? null),
        notesToClient: input.notesToClient ?? null,
      },
    })

    await tx.consultation.update({
      where: { id: consultation.id },
      data: { status: 'APPROVED', reviewedAt: new Date() },
    })

    await tx.outbox.create({
      data: {
        salonId: input.salonId,
        topic: 'consultation.approved',
        // clientProfileId travels with the event: the dispatcher turns this
        // into a notification and cannot look up who to tell without it.
        payloadJson: {
          consultationId: consultation.id,
          servicePlanId: plan.id,
          clientProfileId: consultation.clientProfileId,
        },
      },
    })

    return plan.id
  })

  return { status: 'APPROVED', servicePlanId }
}

/**
 * Approve automatically, but only where the engine and the salon both agree.
 *
 * Deliberately conservative: the engine must have judged it simple and
 * unflagged, and the salon must have opted in. Anything with a risk flag waits
 * for a stylist, which is the entire point of the product.
 */
export async function maybeAutoApprove(input: {
  salonId: string
  consultationId: string
  evaluation: EvaluationResult
}): Promise<string | null> {
  if (input.evaluation.recommendedDecision !== 'AUTO_APPROVE_ELIGIBLE') return null

  const settings = await unsafeDb.salonSettings.findUnique({
    where: { salonId: input.salonId },
    select: { autoApproveSimple: true },
  })
  if (!settings?.autoApproveSimple) return null

  const { servicePlanId } = await reviewConsultation({
    salonId: input.salonId,
    consultationId: input.consultationId,
    reviewerUserId: null,
    decision: 'APPROVE',
    automatic: true,
  })

  return servicePlanId
}

/** A plan with its sessions and frozen chains, for the booking screen. */
export async function loadPlan(salonId: string, servicePlanId: string) {
  const plan = await unsafeDb.servicePlan.findFirst({
    where: { id: servicePlanId, salonId },
    include: {
      sessions: {
        orderBy: { sequence: 'asc' },
        include: { services: true, appointment: true },
      },
      stylistProfile: { select: { id: true, displayName: true } },
      consultation: { select: { id: true, requestedServiceIds: true } },
      requirements: { where: { status: 'PENDING' } },
    },
  })
  if (!plan) throw new DomainError('NOT_FOUND', 'That plan no longer exists.')
  return plan
}

/**
 * Whether a session may be booked right now.
 *
 * Two gates: outstanding pre-requirements due before booking (a patch test, an
 * in-person consult), and the spacing after the previous session — which is
 * measured from when it was actually COMPLETED, not merely booked. The hair
 * has to have had the six weeks.
 */
export async function sessionBookability(
  salonId: string,
  servicePlanId: string,
  sequence: number,
): Promise<{ bookable: boolean; earliestDate: string | null; reason: string | null }> {
  const plan = await loadPlan(salonId, servicePlanId)

  const blocking = plan.requirements.filter((r) => r.dueBefore === 'BOOKING')
  if (blocking.length > 0) {
    return {
      bookable: false,
      earliestDate: null,
      reason: blocking[0]!.rationale,
    }
  }

  const session = plan.sessions.find((s) => s.sequence === sequence)
  if (!session) throw new DomainError('NOT_FOUND', 'That session is not part of this plan.')
  if (session.sequence === 1) return { bookable: true, earliestDate: null, reason: null }

  const previous = plan.sessions.find((s) => s.sequence === sequence - 1)
  if (!previous) return { bookable: true, earliestDate: null, reason: null }

  if (previous.status !== 'COMPLETED') {
    return {
      bookable: false,
      earliestDate: null,
      reason: 'The previous session in your plan has not happened yet.',
    }
  }

  const completedAt = previous.appointment?.chairEndedAt ?? previous.appointment?.endsAt
  if (!completedAt) return { bookable: true, earliestDate: null, reason: null }

  const gapDays = session.minDaysAfterPrevious ?? 0
  const earliest = new Date(completedAt.getTime() + gapDays * 86_400_000)

  if (earliest > new Date()) {
    const days = Math.ceil((earliest.getTime() - Date.now()) / 86_400_000)
    return {
      bookable: true,
      earliestDate: earliest.toISOString().slice(0, 10),
      reason: `Your hair needs another ${days} day${days === 1 ? '' : 's'} before this session.`,
    }
  }

  return { bookable: true, earliestDate: null, reason: null }
}

/** The reviewer's own chair, when they have one. They asked to see the hair. */
async function reviewerStylistId(
  salonId: string,
  reviewerUserId: string | null,
): Promise<string | null> {
  if (!reviewerUserId) return null
  const stylist = await unsafeDb.stylistProfile.findFirst({
    where: { salonId, isActive: true, membership: { userId: reviewerUserId } },
    select: { id: true },
  })
  return stylist?.id ?? null
}

/**
 * Somebody who can do all of it.
 *
 * Prefers a stylist who accepts new clients, then falls back to any capable
 * one — a returning client of a fully-booked colourist should still get a plan
 * rather than a dead end. Returns null only when nobody on the team is signed
 * off for every service in the basket, which is a real answer and worth saying
 * out loud rather than papering over.
 */
async function assignCapableStylist(
  salonId: string,
  serviceIds: readonly string[],
): Promise<string | null> {
  const [openToNew, anyone] = await Promise.all([
    capableStylists(salonId, serviceIds, { forNewClient: true }),
    capableStylists(salonId, serviceIds),
  ])
  return (openToNew[0] ?? anyone[0])?.id ?? null
}
