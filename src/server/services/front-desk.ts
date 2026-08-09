import { dbFor } from '@/server/db/tenant-client'
import { writeConsents } from '@/server/services/signup'

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
  /** Money still outstanding, so the desk can jump straight to the till. */
  needsPayment: boolean
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
  const db = dbFor(salonId)
  const now = opts.now ?? new Date()
  const { from, to } = dayBounds(opts.localDate, opts.timeZone)

  const appointments = await db.appointment.findMany({
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
      invoice: { select: { status: true, totalCents: true, paidCents: true } },
    },
  })

  /*
   * Appointment.consultationId is a plain column, not a relation — an
   * appointment outlives the consultation that produced it. So the open flags
   * come from a second query rather than an include.
   */
  const flagged = new Set(
    (
      await db.riskFlag.findMany({
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
      // No invoice yet on a finished appointment still means money is owed.
      needsPayment: appointment.invoice
        ? appointment.invoice.status !== 'PAID'
        : appointment.estimatedTotalCents > 0,
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
  const db = dbFor(salonId)
  const term = query.trim()
  if (term.length < 2) return []

  const digits = term.replace(/\D/g, '')

  return db.clientProfile.findMany({
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
 * What the till needs to settle one appointment.
 *
 * Prices come from what was agreed on the appointment rather than from the
 * catalog — the client agreed to a figure and that figure is what they pay,
 * even if the service was repriced since. Returns null for an appointment that
 * has not happened, so the screen cannot be opened on a booking nobody has
 * sat down for.
 */
export async function checkoutView(salonId: string, appointmentId: string) {
  const db = dbFor(salonId)
  const appointment = await db.appointment.findFirst({
    where: { id: appointmentId, salonId },
    include: {
      clientProfile: { select: { firstName: true, lastName: true } },
      primaryStylist: { select: { displayName: true } },
      services: { include: { service: { select: { name: true } } } },
      deposits: true,
      invoice: {
        include: {
          lines: { orderBy: { sequence: 'asc' } },
          payments: {
            select: {
              id: true,
              amountCents: true,
              tipCents: true,
              method: true,
              status: true,
              // Refunds so far, so the till can offer what is actually left
              // rather than the original figure — the second refund against a
              // part-refunded payment is otherwise a guess that gets refused.
              refunds: { select: { amountCents: true, status: true } },
            },
          },
        },
      },
    },
  })
  if (!appointment) return null

  const settled = ['IN_CHAIR', 'PROCESSING', 'COMPLETED']
  if (!settled.includes(appointment.status)) return null

  const depositHeldCents = appointment.deposits
    .filter((d) => d.status === 'AUTHORIZED' || d.status === 'CAPTURED')
    .reduce((sum, d) => sum + d.amountCents, 0)

  /*
   * What their membership takes off this bill, said out loud at the counter.
   *
   * `benefitsForBill` computed exactly this and the till never asked for it, so
   * the benefit arrived as an unexplained discount line — which reads as a
   * pricing error to the person paying and is the opposite of the whole reason
   * anybody keeps paying a monthly fee. `withheldReason` matters just as much:
   * a member whose card has failed needs to be told at the counter, where they
   * can fix it, rather than discovering it from a bill that is larger than they
   * expected.
   */
  const { benefitsForBill } = await import('./memberships')
  const membership = await benefitsForBill(
    salonId,
    appointment.clientProfileId,
    appointment.services.map((row) => ({
      serviceId: row.serviceId,
      description: row.service.name,
      quantity: 1,
      unitPriceCents: row.priceCents,
    })),
  )

  return {
    clientName:
      `${appointment.clientProfile.firstName} ${appointment.clientProfile.lastName ?? ''}`.trim(),
    stylistName: appointment.primaryStylist.displayName,
    serviceNames: appointment.services.map((s) => s.service.name),
    lines: appointment.services.map((row) => ({
      // The id, so a price edited at the till can be measured against what the
      // client actually agreed to rather than against the catalogue.
      appointmentServiceId: row.id,
      description: row.service.name,
      priceCents: row.priceCents,
    })),
    agreedTotalCents: appointment.estimatedTotalCents,
    depositHeldCents,
    membership: membership
      ? {
          planName: membership.planName,
          totalCents: membership.totalCents,
          withheldReason: membership.withheldReason,
          benefits: membership.benefits.map((benefit) => ({
            label: benefit.label,
            discountCents: benefit.discountCents,
          })),
        }
      : null,
    invoice: appointment.invoice
      ? {
          id: appointment.invoice.id,
          number: appointment.invoice.number,
          status: appointment.invoice.status,
          totalCents: appointment.invoice.totalCents,
          paidCents: appointment.invoice.paidCents,
          taxCents: appointment.invoice.taxCents,
          discountCents: appointment.invoice.discountCents,
          tipCents: appointment.invoice.tipCents,
          payments: appointment.invoice.payments.map((payment) => {
            const refunded = payment.refunds
              .filter((refund) => refund.status === 'SUCCEEDED')
              .reduce((sum, refund) => sum + refund.amountCents, 0)
            return {
              id: payment.id,
              amountCents: payment.amountCents,
              tipCents: payment.tipCents,
              method: payment.method,
              status: payment.status,
              refundedCents: refunded,
              // Mirrors `refundPayment`'s own arithmetic, tip included. Showing
              // a larger figure here produces a refusal at the moment somebody
              // is trying to put money back, which is the worst time for it.
              refundableCents: payment.amountCents + payment.tipCents - refunded,
            }
          }),
        }
      : null,
  }
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
  const db = dbFor(salonId)
  const client = await db.clientProfile.findFirst({
    where: { id: clientProfileId, salonId },
    include: { hairProfile: true },
  })
  if (!client) return null

  const accuracy = await db.quoteAccuracy.findMany({
    where: { salonId, appointment: { clientProfileId } },
    orderBy: { computedAt: 'desc' },
    take: 10,
    select: { overranByMin: true, estimatedDurationMin: true, actualDurationMin: true },
  })

  const overruns = accuracy.filter((row) => row.overranByMin > 0)

  /*
   * Fees this person has been charged for cancelling late.
   *
   * `assessCancellation` has been writing these rows since the commerce work
   * landed and no screen ever read one, so the salon charged a fee it could
   * not see and could not waive — while the client, who could see it on their
   * card statement, rang up about it. The waive path existed at the same time
   * and was reachable from nowhere for the same reason.
   */
  const fees = await db.cancellationFee.findMany({
    where: { salonId, appointment: { clientProfileId } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      appointmentId: true,
      computedCents: true,
      chargedCents: true,
      status: true,
      waiveReason: true,
      createdAt: true,
      appointment: {
        select: {
          startsAt: true,
          services: { select: { service: { select: { name: true } } } },
        },
      },
    },
  })

  /*
   * Money of theirs the salon is currently holding.
   *
   * The lifecycle runs itself — `assessCancellation` forfeits or releases on a
   * late cancellation, and a job releases an authorisation before it expires —
   * but the manual half had no screen. A client who did not turn up this
   * morning is a decision somebody has to make today, and "release it" and
   * "keep it" both existed as reasoned, audited operations that nothing could
   * call.
   */
  const deposits = await db.deposit.findMany({
    where: {
      salonId,
      clientProfileId,
      status: { in: ['PENDING', 'AUTHORIZED', 'CAPTURED', 'FORFEITED', 'FAILED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      amountCents: true,
      status: true,
      authorizationExpiresAt: true,
      createdAt: true,
      appointment: {
        select: {
          startsAt: true,
          services: { select: { service: { select: { name: true } } } },
        },
      },
    },
  })

  return {
    client,
    accuracy,
    fees,
    deposits,
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
  const db = dbFor(salonId)
  const { from, to } = dayBounds(opts.localDate, opts.timeZone)

  const [stylists, segments] = await Promise.all([
    db.stylistProfile.findMany({
      where: { salonId, isActive: true },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true, colorHex: true },
    }),
    db.appointmentSegment.findMany({
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

/**
 * Standing notes about a client.
 *
 * An empty box means no note, not an empty note — a stylist who clears the
 * field is saying "there is nothing to know here", and a zero-length string
 * would render as a note that exists and says nothing.
 */
export async function saveClientNotes(
  salonId: string,
  clientProfileId: string,
  internalNotes: string | null,
): Promise<void> {
  const db = dbFor(salonId)
  const trimmed = internalNotes?.trim()
  await db.clientProfile.updateMany({
    where: { id: clientProfileId, salonId },
    data: { internalNotes: trimmed && trimmed.length > 0 ? trimmed : null },
  })
}

/** A note about one visit rather than about the person. */
export async function saveAppointmentNote(
  salonId: string,
  appointmentId: string,
  internalNote: string | null,
): Promise<void> {
  const db = dbFor(salonId)
  const trimmed = internalNote?.trim()
  await db.appointment.updateMany({
    where: { id: appointmentId, salonId },
    data: { internalNote: trimmed && trimmed.length > 0 ? trimmed : null },
  })
}

/**
 * Create a client at the desk.
 *
 * The counterpart to self-signup, and the commoner case: somebody rings up or
 * walks in and the receptionist takes their details while they are standing
 * there. `ClientProfile.userId` stays null — they have no login and do not
 * need one to be booked in. If they later sign up with the same email, the
 * signup path claims THIS record rather than making a second one.
 *
 * Consent rows are written here for the same reason they are written at
 * signup: the send path now treats an absent marketing row as "no", so a
 * walk-in created without them would silently receive nothing. Marketing
 * defaults to off, because somebody reading their email address down a phone
 * line has not opted into anything.
 */
export async function createClientAtDesk(input: {
  salonId: string
  firstName: string
  lastName?: string | null
  email?: string | null
  phone?: string | null
  internalNotes?: string | null
  marketingOptIn?: boolean
}): Promise<{ id: string; mergedWithExisting: boolean }> {
  const db = dbFor(input.salonId)
  const email = input.email?.trim().toLowerCase() || null
  const phoneDigits = input.phone?.replace(/\D/g, '') || null

  /*
   * Look for the same person before making a second one. A salon that ends up
   * with three records for the same client has three partial hair histories
   * and no way to tell which is right — and the front desk is exactly where
   * that happens, because the person on the phone does not know whether they
   * are already on file.
   */
  if (email || (phoneDigits && phoneDigits.length >= 7)) {
    const existing = await db.clientProfile.findFirst({
      where: {
        salonId: input.salonId,
        status: 'ACTIVE',
        OR: [
          ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []),
          ...(phoneDigits ? [{ phone: { contains: phoneDigits } }] : []),
        ],
      },
      select: { id: true },
    })
    if (existing) return { id: existing.id, mergedWithExisting: true }
  }

  const created = await db.clientProfile.create({
    data: {
      salonId: input.salonId,
      firstName: input.firstName.trim(),
      lastName: input.lastName?.trim() || '',
      email,
      phone: input.phone?.trim() || null,
      internalNotes: input.internalNotes?.trim() || null,
      source: 'FRONT_DESK',
    },
    select: { id: true },
  })

  await writeConsents(input.salonId, created.id, input.marketingOptIn ?? false, 'FRONT_DESK')

  return { id: created.id, mergedWithExisting: false }
}
