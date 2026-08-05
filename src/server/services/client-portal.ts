import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import type { EvaluationResult } from '@/domain/consultation/types'
import type { TimelineEntry } from '@/components/salon/hair-timeline'

/**
 * Reads for the client portal.
 *
 * Kept apart from the write services so the portal's pages do one query set
 * each rather than assembling themselves out of six repositories. Everything
 * here is scoped by clientProfileId as well as salonId — a client should not be
 * able to read another client's row even if the tenancy layer somehow let them
 * through.
 */

export async function clientHome(salonId: string, clientProfileId: string) {
  const now = new Date()

  const [next, openConsultations, plans, recent] = await Promise.all([
    unsafeDb.appointment.findFirst({
      where: {
        salonId,
        clientProfileId,
        status: { in: ['BOOKED', 'CONFIRMED'] },
        startsAt: { gte: now },
      },
      orderBy: { startsAt: 'asc' },
      include: {
        primaryStylist: { select: { displayName: true } },
        location: { select: { name: true } },
        services: { include: { service: { select: { name: true } } } },
      },
    }),

    unsafeDb.consultation.findMany({
      where: {
        salonId,
        clientProfileId,
        status: { in: ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'NEEDS_MORE_INFO'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        requestedServiceIds: true,
        updatedAt: true,
        slaDueAt: true,
      },
    }),

    // Approved plans with something still to book — the client's actual to-do.
    unsafeDb.servicePlan.findMany({
      where: { salonId, clientProfileId, status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        sessions: {
          orderBy: { sequence: 'asc' },
          include: { appointment: { select: { id: true, startsAt: true, status: true } } },
        },
      },
    }),

    // What they had last, for one-tap rebooking.
    unsafeDb.appointment.findFirst({
      where: { salonId, clientProfileId, status: 'COMPLETED' },
      orderBy: { startsAt: 'desc' },
      include: {
        primaryStylist: { select: { id: true, displayName: true } },
        services: { select: { serviceId: true, service: { select: { name: true } } } },
      },
    }),
  ])

  const serviceNames = await namesFor(
    salonId,
    openConsultations.flatMap((c) => c.requestedServiceIds),
  )

  return {
    next,
    openConsultations: openConsultations.map((consultation) => ({
      ...consultation,
      serviceNames: consultation.requestedServiceIds.map((id) => serviceNames[id] ?? 'Service'),
    })),
    plans: plans.filter((plan) => plan.sessions.some((session) => !session.appointment)),
    recent,
  }
}

export async function clientAppointments(salonId: string, clientProfileId: string) {
  const now = new Date()

  const appointments = await unsafeDb.appointment.findMany({
    where: { salonId, clientProfileId },
    orderBy: { startsAt: 'desc' },
    take: 50,
    include: {
      primaryStylist: { select: { displayName: true } },
      location: { select: { name: true } },
      services: { include: { service: { select: { name: true } } } },
    },
  })

  return {
    upcoming: appointments
      .filter((a) => a.startsAt >= now && !['CANCELLED', 'NO_SHOW'].includes(a.status))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    past: appointments.filter(
      (a) => a.startsAt < now || ['CANCELLED', 'NO_SHOW'].includes(a.status),
    ),
  }
}

/** The consultation, its services, and the latest evaluation if there is one. */
export async function consultationContext(salonId: string, consultationId: string) {
  const consultation = await unsafeDb.consultation.findFirst({
    where: { id: consultationId, salonId },
    select: {
      id: true,
      status: true,
      requestedServiceIds: true,
      clientProfileId: true,
      latestEvaluationId: true,
      /*
       * `notesToClient` was collected in the decision panel, persisted on both
       * ConsultationReview and ServicePlan, and selected by nothing — so the
       * stylist wrote the client a message the client could never read. It is
       * the one part of the decision written in a person's own words, which
       * makes it the part most worth showing.
       */
      servicePlan: { select: { id: true, status: true, notesToClient: true } },
    },
  })
  if (!consultation) throw new DomainError('NOT_FOUND', 'That consultation no longer exists.')

  const services = await unsafeDb.service.findMany({
    where: { salonId, id: { in: consultation.requestedServiceIds } },
    select: { id: true, name: true, basePriceCents: true },
  })

  let evaluation: EvaluationResult | null = null
  if (consultation.latestEvaluationId) {
    const row = await unsafeDb.ruleEvaluation.findUnique({
      where: { id: consultation.latestEvaluationId },
      select: { outputSnapshotJson: true },
    })
    evaluation = (row?.outputSnapshotJson as EvaluationResult | undefined) ?? null
  }

  return {
    consultation,
    services,
    serviceNames: Object.fromEntries(services.map((s) => [s.id, s.name])),
    evaluation,
    servicePlanId: consultation.servicePlan?.id ?? null,
    notesToClient: consultation.servicePlan?.notesToClient ?? null,
  }
}

/**
 * The hair history, assembled from the rows that actually record what happened.
 *
 * Appointments give the shape of the visit; formulas give what was on the hair.
 * Both matter — "balayage, went well" is a different record from "balayage, 30
 * vol, lifted to 8, banded at the mids".
 */
export async function hairTimeline(
  salonId: string,
  clientProfileId: string,
): Promise<TimelineEntry[]> {
  const [appointments, formulas, patchTests, consultations] = await Promise.all([
    unsafeDb.appointment.findMany({
      where: { salonId, clientProfileId, status: 'COMPLETED' },
      orderBy: { startsAt: 'desc' },
      take: 40,
      include: {
        primaryStylist: { select: { displayName: true } },
        services: { include: { service: { select: { name: true, isLightening: true } } } },
      },
    }),
    unsafeDb.formula.findMany({
      where: { salonId, clientProfileId },
      orderBy: { createdAt: 'desc' },
      take: 40,
      include: { stylistProfile: { select: { displayName: true } } },
    }),
    unsafeDb.patchTest.findMany({
      where: { salonId, clientProfileId },
      orderBy: { appliedAt: 'desc' },
      take: 10,
    }),
    unsafeDb.consultation.findMany({
      where: { salonId, clientProfileId, status: { in: ['APPROVED', 'DECLINED'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, createdAt: true, status: true, requestedServiceIds: true },
    }),
  ])

  const names = await namesFor(
    salonId,
    consultations.flatMap((c) => c.requestedServiceIds),
  )

  const entries: TimelineEntry[] = [
    ...appointments.map((appointment): TimelineEntry => {
      const serviceNames = appointment.services.map((s) => s.service.name)
      return {
        id: `appt-${appointment.id}`,
        kind: appointment.services.some((s) => s.service.isLightening)
          ? 'LIGHTENING'
          : 'APPOINTMENT',
        occurredAt: appointment.startsAt.toISOString(),
        title: serviceNames.join(' + ') || 'Appointment',
        stylistName: appointment.primaryStylist.displayName,
        facts:
          appointment.chairStartedAt && appointment.chairEndedAt
            ? [
                {
                  label: 'Time in the chair',
                  value: `${Math.round(
                    (appointment.chairEndedAt.getTime() - appointment.chairStartedAt.getTime()) /
                      60_000,
                  )} min`,
                },
              ]
            : undefined,
      }
    }),

    ...formulas.map((formula): TimelineEntry => {
      const facts = [
        formula.developerVolume
          ? { label: 'Developer', value: `${formula.developerVolume} vol` }
          : null,
        formula.processingTimeMin
          ? { label: 'Processing', value: `${formula.processingTimeMin} min` }
          : null,
        formula.resultRating ? { label: 'Result', value: `${formula.resultRating}/5` } : null,
      ].filter((f): f is { label: string; value: string } => f !== null)

      return {
        id: `formula-${formula.id}`,
        kind: 'COLOUR',
        occurredAt: formula.createdAt.toISOString(),
        title: formula.name ?? 'Colour formula',
        detail: formula.resultNotes ?? formula.applicationNotes,
        stylistName: formula.stylistProfile?.displayName ?? null,
        facts: facts.length > 0 ? facts : undefined,
        outcome: formula.outcome as TimelineEntry['outcome'],
      }
    }),

    ...patchTests.map((test): TimelineEntry => ({
      id: `patch-${test.id}`,
      kind: 'PATCH_TEST',
      occurredAt: test.appliedAt.toISOString(),
      title:
        test.result === 'NEGATIVE'
          ? 'Patch test — all clear'
          : `Patch test — ${test.result.toLowerCase()}`,
      detail:
        test.result === 'NEGATIVE'
          ? `Valid until ${test.validUntil.toISOString().slice(0, 10)}.`
          : null,
      outcome: test.result === 'NEGATIVE' ? 'GOOD' : 'POOR',
    })),

    ...consultations.map((consultation): TimelineEntry => ({
      id: `consult-${consultation.id}`,
      kind: 'CONSULTATION',
      occurredAt: consultation.createdAt.toISOString(),
      title:
        consultation.requestedServiceIds.map((id) => names[id] ?? 'Service').join(' + ') ||
        'Consultation',
      detail: consultation.status === 'APPROVED' ? 'Plan agreed.' : 'Not taken forward.',
    })),
  ]

  return entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
}

async function namesFor(
  salonId: string,
  serviceIds: readonly string[],
): Promise<Record<string, string>> {
  if (serviceIds.length === 0) return {}
  const services = await unsafeDb.service.findMany({
    where: { salonId, id: { in: [...new Set(serviceIds)] } },
    select: { id: true, name: true },
  })
  return Object.fromEntries(services.map((s) => [s.id, s.name]))
}
