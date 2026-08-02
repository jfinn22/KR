import { unsafeDb } from '@/server/db/client'
import {
  analyseFlags,
  buildFunnel,
  comparePeriods,
  computeAccuracy,
  computeUtilisation,
  worstDropOff,
  type FunnelStep,
} from '@/domain/analytics/metrics'
import { dayBounds } from './front-desk'

/**
 * What the owner sees.
 *
 * The dashboard has one job that no other salon software does: show whether
 * the estimates are actually true. Everything else here is ordinary reporting
 * that happens to be useful; quote accuracy is the number the product is
 * selling, so it is the number shown first and measured most carefully.
 *
 * Every rate can come back null. A conversion figure from six consultations is
 * noise, and an owner who staffs a Saturday on the strength of it is worse off
 * than one who was told there is not enough data yet.
 */

export interface Range {
  from: Date
  to: Date
}

export function lastDays(days: number, timeZone: string, now = new Date()): Range {
  const today = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(now)

  const { to } = dayBounds(today, timeZone)
  return { from: new Date(to.getTime() - days * 86_400_000), to }
}

/**
 * The headline: are the quotes true?
 *
 * Built on QuoteAccuracy rows, which record chair time rather than booked
 * time. Booked time expands to fill whatever slot was allocated, so an
 * accuracy metric built on it converges on 100% and tells a salon nothing.
 */
export async function accuracyReport(salonId: string, range: Range) {
  const rows = await unsafeDb.quoteAccuracy.findMany({
    where: { salonId, computedAt: { gte: range.from, lt: range.to } },
    select: {
      estimatedDurationMin: true,
      actualDurationMin: true,
      stylistProfileId: true,
      estimatedPriceCents: true,
      actualPriceCents: true,
    },
  })

  const overall = computeAccuracy(
    rows.map((row) => ({
      estimatedMin: row.estimatedDurationMin,
      actualMin: row.actualDurationMin,
    })),
  )

  // Per stylist, because "the salon runs 20 minutes over" is usually one
  // person's pace rather than a property of the salon.
  const byStylist = new Map<string, { estimatedMin: number; actualMin: number }[]>()
  for (const row of rows) {
    if (!row.stylistProfileId) continue
    const list = byStylist.get(row.stylistProfileId) ?? []
    list.push({ estimatedMin: row.estimatedDurationMin, actualMin: row.actualDurationMin })
    byStylist.set(row.stylistProfileId, list)
  }

  const stylists = await unsafeDb.stylistProfile.findMany({
    where: { salonId, id: { in: [...byStylist.keys()] } },
    select: { id: true, displayName: true },
  })

  const priceDrift = rows
    .filter((row) => row.actualPriceCents > 0)
    .map((row) => row.actualPriceCents - row.estimatedPriceCents)

  return {
    overall,
    perStylist: stylists
      .map((stylist) => ({
        stylistId: stylist.id,
        name: stylist.displayName,
        ...computeAccuracy(byStylist.get(stylist.id) ?? []),
      }))
      .sort((a, b) => (b.sampleCount ?? 0) - (a.sampleCount ?? 0)),
    // Whether the final bill matched the quote, which is a different promise
    // from whether the time did — and the one clients complain about.
    priceHeldRate:
      priceDrift.length >= 8
        ? priceDrift.filter((cents) => Math.abs(cents) <= 500).length / priceDrift.length
        : null,
  }
}

/**
 * Where consultations stop.
 *
 * The stages are genuinely nested — every consultation that was approved was
 * also submitted, and so on — because a funnel is only readable if each step
 * is a subset of the one above it. A later stage that can exceed an earlier
 * one produces a chart where somebody "recovers" from dropping out, and the
 * worst-drop calculation on top of it becomes nonsense.
 *
 * Photos are therefore NOT a stage. They are optional for a non-chemical
 * service, so a client can reach "sent it in" without ever adding one. Photo
 * completion is reported alongside instead, where it is still the number
 * worth acting on without pretending to be a gate.
 */
export async function funnelReport(
  salonId: string,
  range: Range,
): Promise<{
  steps: FunnelStep[]
  worst: FunnelStep | null
  photos: { needed: number; provided: number }
}> {
  const where = { salonId, createdAt: { gte: range.from, lt: range.to } }

  const [started, withAnswers, submitted, approved, booked, chemical, chemicalWithPhotos] =
    await Promise.all([
      unsafeDb.consultation.count({ where }),
      unsafeDb.consultation.count({ where: { ...where, answers: { some: {} } } }),
      unsafeDb.consultation.count({ where: { ...where, submittedAt: { not: null } } }),
      unsafeDb.consultation.count({ where: { ...where, status: 'APPROVED' } }),
      unsafeDb.consultation.count({
        where: { ...where, servicePlan: { sessions: { some: { appointment: { isNot: null } } } } },
      }),
      // Only chemical work actually needs photographs, so only those count
      // toward a completion rate — measuring cuts against a photo requirement
      // they never had would report a problem that does not exist.
      unsafeDb.consultation.count({
        where: { ...where, requestedServiceIds: { isEmpty: false } },
      }),
      unsafeDb.consultation.count({ where: { ...where, photos: { some: {} } } }),
    ])

  const steps = buildFunnel([
    { key: 'started', label: 'Started', count: started },
    { key: 'answered', label: 'Answered something', count: withAnswers },
    { key: 'submitted', label: 'Sent it in', count: submitted },
    { key: 'approved', label: 'Approved', count: approved },
    { key: 'booked', label: 'Booked', count: booked },
  ])

  return {
    steps,
    worst: worstDropOff(steps),
    photos: { needed: chemical, provided: chemicalWithPhotos },
  }
}

/**
 * How much of the rostered day turned into work.
 *
 * Reported twice — raw and effective — so the difference makes the case for
 * interleaving in the salon's own numbers rather than in a marketing claim.
 */
export async function utilisationReport(salonId: string, range: Range) {
  const [stylists, segments] = await Promise.all([
    unsafeDb.stylistProfile.findMany({
      where: { salonId, isActive: true },
      select: { id: true, displayName: true },
    }),
    unsafeDb.appointmentSegment.findMany({
      where: {
        salonId,
        state: 'ACTIVE',
        startsAt: { gte: range.from, lt: range.to },
      },
      select: {
        stylistProfileId: true,
        startsAt: true,
        endsAt: true,
        blocksStylist: true,
      },
    }),
  ])

  /** An eight-hour shift, the unit a salon rosters in. */
  const SHIFT_MIN = 8 * 60

  return stylists
    .map((stylist) => {
      const theirs = segments.filter((s) => s.stylistProfileId === stylist.id)

      const minutes = (blocking: boolean) =>
        theirs
          .filter((s) => s.blocksStylist === blocking)
          .reduce((sum, s) => sum + (s.endsAt.getTime() - s.startsAt.getTime()) / 60_000, 0)

      /*
       * The denominator is days this stylist actually worked, not calendar days
       * in the range.
       *
       * Dividing by the whole range assumes everybody was rostered every
       * working day, which is never true — and over a 90-day window it drags
       * every figure to a rounded zero, which reads as "nobody is busy" when
       * the real answer is "we only have data for a fortnight". Counting the
       * days with any segment at all makes the number mean "of the time you
       * were in, how much was chair time", which is the question being asked.
       */
      const workedDays = new Set(theirs.map((s) => s.startsAt.toISOString().slice(0, 10))).size

      return {
        stylistId: stylist.id,
        name: stylist.displayName,
        chairMin: Math.round(minutes(true)),
        freedMin: Math.round(minutes(false)),
        workedDays,
        ...computeUtilisation({
          availableMin: workedDays * SHIFT_MIN,
          chairMin: minutes(true),
          interleavedMin: minutes(false),
        }),
      }
    })
    .sort((a, b) => (b.utilisation ?? 0) - (a.utilisation ?? 0))
}

/** Which rules earn their place, and which are training people to click through. */
export async function ruleReport(salonId: string, range: Range) {
  const flags = await unsafeDb.riskFlag.groupBy({
    by: ['code', 'status'],
    where: { salonId, createdAt: { gte: range.from, lt: range.to } },
    _count: true,
  })

  const byCode = new Map<string, { fired: number; overridden: number }>()
  for (const row of flags) {
    const entry = byCode.get(row.code) ?? { fired: 0, overridden: 0 }
    entry.fired += row._count
    if (row.status === 'OVERRIDDEN') entry.overridden += row._count
    byCode.set(row.code, entry)
  }

  return analyseFlags([...byCode.entries()].map(([code, counts]) => ({ code, ...counts })))
}

/** Takings, paired with the period before so a single figure cannot mislead. */
export async function revenueReport(salonId: string, range: Range) {
  const payments = await unsafeDb.payment.findMany({
    where: {
      salonId,
      status: 'SUCCEEDED',
      capturedAt: {
        gte: new Date(range.from.getTime() - (range.to.getTime() - range.from.getTime())),
        lt: range.to,
      },
    },
    select: { amountCents: true, tipCents: true, capturedAt: true },
  })

  const compared = comparePeriods(
    payments
      .filter((p) => p.capturedAt !== null)
      .map((p) => ({ cents: p.amountCents + p.tipCents, at: p.capturedAt! })),
    range,
  )

  const [completed, noShows, cancelled] = await Promise.all([
    unsafeDb.appointment.count({
      where: { salonId, status: 'COMPLETED', startsAt: { gte: range.from, lt: range.to } },
    }),
    unsafeDb.appointment.count({
      where: { salonId, status: 'NO_SHOW', startsAt: { gte: range.from, lt: range.to } },
    }),
    unsafeDb.appointment.count({
      where: { salonId, status: 'CANCELLED', startsAt: { gte: range.from, lt: range.to } },
    }),
  ])

  const booked = completed + noShows + cancelled

  return {
    ...compared,
    completed,
    noShows,
    cancelled,
    // The metric a deposit policy is supposed to move.
    noShowRate: booked >= 8 ? noShows / booked : null,
  }
}

/** Everything the dashboard needs, in one pass. */
export async function ownerDashboard(salonId: string, timeZone: string, days = 30) {
  const range = lastDays(days, timeZone)

  const [accuracy, funnel, utilisation, rules, revenue] = await Promise.all([
    accuracyReport(salonId, range),
    funnelReport(salonId, range),
    utilisationReport(salonId, range),
    ruleReport(salonId, range),
    revenueReport(salonId, range),
  ])

  return { range, accuracy, funnel, utilisation, rules, revenue }
}
