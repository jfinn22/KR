import { unsafeDb } from '@/server/db/client'

/**
 * The front desk's day.
 *
 * One question, asked constantly: what is happening right now, and what needs
 * a person. Everything here is scoped to a single local day and ordered by
 * time, because the desk reads it as a timeline rather than a table.
 *
 * "Right now" is deliberately a computed grouping rather than a stored status:
 * an appointment that should have started ten minutes ago and has not is the
 * single most useful thing this screen can show, and no status field records it.
 */

export interface DeskAppointment {
  id: string
  startsAt: Date
  endsAt: Date
  status: string
  clientName: string
  clientProfileId: string
  clientIsNew: boolean
  stylistName: string
  stylistProfileId: string
  serviceNames: string[]
  estimatedTotalCents: number
  depositCents: number
  depositPaid: boolean
  checkedInAt: Date | null
  chairStartedAt: Date | null
  chairEndedAt: Date | null
  hasOpenFlags: boolean
  runningLateMin: number | null
}

export interface DeskDay {
  localDate: string
  arriving: DeskAppointment[]
  inChair: DeskAppointment[]
  processing: DeskAppointment[]
  finished: DeskAppointment[]
  overdue: DeskAppointment[]
  stats: {
    booked: number
    arrived: number
    expectedCents: number
    unpaidDeposits: number
  }
}

/** The bounds of a local calendar day, as instants. */
export function dayBounds(localDate: string, timeZone: string): { from: Date; to: Date } {
  // Resolve the zone's offset at local noon, which is never inside a DST jump.
  const noon = new Date(`${localDate}T12:00:00Z`)
  const zoned = new Date(noon.toLocaleString('en-US', { timeZone }))
  const offsetMs = zoned.getTime() - noon.getTime()

  const from = new Date(new Date(`${localDate}T00:00:00Z`).getTime() - offsetMs)
  const to = new Date(from.getTime() + 24 * 3_600_000)
  return { from, to }
}

export async function deskDay(
  salonId: string,
  opts: { localDate: string; timeZone: string; locationId?: string | null; now?: Date },
): Promise<DeskDay> {
  const now = opts.now ?? new Date()
  const { from, to } = dayBounds(opts.localDate, opts.timeZone)

  const appointments = await unsafeDb.appointment.findMany({
    where: {
      salonId,
      startsAt: { gte: from, lt: to },
      status: { notIn: ['CANCELLED'] },
      ...(opts.locationId ? { locationId: opts.locationId } : {}),
    },
    orderBy: { startsAt: 'asc' },
    include: {
      clientProfile: {
        select: { id: true, firstName: true, lastName: true, completedVisits: true },
      },
      primaryStylist: { select: { id: true, displayName: true } },
      services: { include: { service: { select: { name: true } } } },
      deposits: { select: { status: true, amountCents: true } },
    },
  })

  /*
   * Appointment.consultationId is a plain column, not a relation — an
   * appointment outlives the consultation that produced it. So the open flags
   * come from a second query rather than an include.
   */
  const flagged = new Set(
    (
      await unsafeDb.riskFlag.findMany({
        where: {
          salonId,
          status: 'OPEN',
          consultationId: {
            in: appointments.map((a) => a.consultationId).filter((id): id is string => id !== null),
          },
        },
        select: { consultationId: true },
      })
    ).map((f) => f.consultationId),
  )

  const rows = appointments.map((appointment): DeskAppointment => {
    const depositPaid = appointment.deposits.some(
      (d) => d.status === 'AUTHORIZED' || d.status === 'CAPTURED',
    )

    // Started late, or should have and has not — the number the desk acts on.
    const runningLateMin =
      appointment.status === 'BOOKED' ||
      appointment.status === 'CONFIRMED' ||
      appointment.status === 'CHECKED_IN'
        ? Math.max(0, Math.floor((now.getTime() - appointment.startsAt.getTime()) / 60_000))
        : null

    return {
      id: appointment.id,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      clientProfileId: appointment.clientProfile.id,
      clientName:
        `${appointment.clientProfile.firstName} ${appointment.clientProfile.lastName ?? ''}`.trim(),
      clientIsNew: appointment.clientProfile.completedVisits === 0,
      stylistName: appointment.primaryStylist.displayName,
      stylistProfileId: appointment.primaryStylist.id,
      serviceNames: appointment.services.map((s) => s.service.name),
      estimatedTotalCents: appointment.estimatedTotalCents,
      depositCents: appointment.deposits.reduce((sum, d) => sum + d.amountCents, 0),
      depositPaid,
      checkedInAt: appointment.checkedInAt,
      chairStartedAt: appointment.chairStartedAt,
      chairEndedAt: appointment.chairEndedAt,
      hasOpenFlags: appointment.consultationId !== null && flagged.has(appointment.consultationId),
      runningLateMin: runningLateMin && runningLateMin > 0 ? runningLateMin : null,
    }
  })

  const notStarted = (r: DeskAppointment) =>
    r.status === 'BOOKED' || r.status === 'CONFIRMED' || r.status === 'CHECKED_IN'

  return {
    localDate: opts.localDate,
    // Late first: the whole point of this screen is catching the slip.
    overdue: rows.filter((r) => notStarted(r) && (r.runningLateMin ?? 0) >= 10),
    arriving: rows.filter((r) => notStarted(r) && (r.runningLateMin ?? 0) < 10),
    inChair: rows.filter((r) => r.status === 'IN_CHAIR'),
    processing: rows.filter((r) => r.status === 'PROCESSING'),
    finished: rows.filter((r) => r.status === 'COMPLETED' || r.status === 'NO_SHOW'),
    stats: {
      booked: rows.length,
      arrived: rows.filter((r) => r.checkedInAt !== null).length,
      expectedCents: rows.reduce((sum, r) => sum + r.estimatedTotalCents, 0),
      unpaidDeposits: rows.filter((r) => r.depositCents > 0 && !r.depositPaid).length,
    },
  }
}

/**
 * Find a client at the desk.
 *
 * Matches name, email or phone in one box, because whoever is standing there
 * gave one of the three and the receptionist should not have to choose a field
 * first. Phone matching strips formatting — nobody types the same number twice
 * the same way.
 */
export async function findClients(salonId: string, query: string, limit = 20) {
  const term = query.trim()
  if (term.length < 2) return []

  const digits = term.replace(/\D/g, '')

  return unsafeDb.clientProfile.findMany({
    where: {
      salonId,
      status: 'ACTIVE',
      OR: [
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
      ],
    },
    orderBy: [{ lastVisitAt: 'desc' }, { lastName: 'asc' }],
    take: limit,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      completedVisits: true,
      noShowCount: true,
      lastVisitAt: true,
    },
  })
}

/**
 * One client's record, as the salon sees it.
 *
 * Includes what the client's own timeline cannot show them: how often the
 * estimate has run over for this person specifically. A client whose colour
 * always takes forty minutes longer is worth knowing about before the day it
 * happens again.
 */
export async function clientRecord(salonId: string, clientProfileId: string) {
  const client = await unsafeDb.clientProfile.findFirst({
    where: { id: clientProfileId, salonId },
    include: { hairProfile: true },
  })
  if (!client) return null

  const accuracy = await unsafeDb.quoteAccuracy.findMany({
    where: { salonId, appointment: { clientProfileId } },
    orderBy: { computedAt: 'desc' },
    take: 10,
    select: { overranByMin: true, estimatedDurationMin: true, actualDurationMin: true },
  })

  const overruns = accuracy.filter((row) => row.overranByMin > 0)

  return {
    client,
    accuracy,
    overrunCount: overruns.length,
    averageOverrunMin:
      overruns.length > 0
        ? Math.round(overruns.reduce((sum, r) => sum + r.overranByMin, 0) / overruns.length)
        : 0,
  }
}

/**
 * The day's diary by stylist, for the calendar column view.
 *
 * Returns segments rather than appointments, because a processing gap is the
 * thing the front desk most wants to see: it is the twenty minutes somebody
 * could be squeezed into.
 */
export async function daySchedule(
  salonId: string,
  opts: { localDate: string; timeZone: string; locationId?: string | null },
) {
  const { from, to } = dayBounds(opts.localDate, opts.timeZone)

  const [stylists, segments] = await Promise.all([
    unsafeDb.stylistProfile.findMany({
      where: { salonId, isActive: true },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true, colorHex: true },
    }),
    unsafeDb.appointmentSegment.findMany({
      where: {
        salonId,
        startsAt: { gte: from, lt: to },
        state: { in: ['ACTIVE', 'HOLD'] },
        ...(opts.locationId ? { locationId: opts.locationId } : {}),
      },
      orderBy: { startsAt: 'asc' },
      include: {
        appointment: {
          select: {
            id: true,
            status: true,
            clientProfile: { select: { firstName: true, lastName: true } },
            services: { select: { service: { select: { name: true } } } },
          },
        },
      },
    }),
  ])

  return {
    stylists,
    columns: stylists.map((stylist) => ({
      stylist,
      segments: segments
        .filter((segment) => segment.stylistProfileId === stylist.id)
        .map((segment) => ({
          id: segment.id,
          kind: segment.kind,
          startsAt: segment.startsAt,
          endsAt: segment.endsAt,
          blocksStylist: segment.blocksStylist,
          state: segment.state,
          appointmentId: segment.appointment?.id ?? null,
          clientName: segment.appointment
            ? `${segment.appointment.clientProfile.firstName} ${
                segment.appointment.clientProfile.lastName ?? ''
              }`.trim()
            : 'Held',
          serviceNames: segment.appointment?.services.map((s) => s.service.name) ?? [],
          status: segment.appointment?.status ?? 'HOLD',
        })),
    })),
  }
}
