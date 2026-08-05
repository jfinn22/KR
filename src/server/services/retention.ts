import { unsafeDb } from '@/server/db/client'
import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import { materialiseNotification } from './notifications'
import {
  firstTimersAtRisk,
  rebookRates,
  FIRST_TIMER_GRACE_DAYS,
  REBOOK_WINDOW_DAYS,
  type AtRisk,
  type RebookRate,
  type Visit,
} from '@/domain/retention/windows'

/**
 * Keeping the clients a salon already has.
 *
 * Everything here reads appointments rather than the counters on
 * `ClientProfile`. That is deliberate: a counter is a running total somebody
 * has to remember to keep right, and this one was double-counted for months
 * without anybody noticing, because `completedVisits === 0` — the only thing
 * that ever reads it — is still 0 either way. Retention is the first feature
 * that reads the actual number, so it reads the appointments.
 *
 * The other rule throughout: say nothing rather than say zero. A stylist with
 * no mature visits has no rebook rate, and printing 0% next to their name is a
 * lie somebody will bring up in a review.
 */

export interface RebookReport {
  stylistProfileId: string
  displayName: string
  eligible: number
  returned: number
  rate: number | null
}

export async function rebookReport(
  salonId: string,
  range: { from: Date; to: Date },
  now = new Date(),
): Promise<RebookReport[]> {
  const db = dbFor(salonId)

  const [inPeriod, everything, stylists] = await Promise.all([
    db.appointment.findMany({
      where: { salonId, status: 'COMPLETED', startsAt: { gte: range.from, lt: range.to } },
      select: { clientProfileId: true, primaryStylistId: true, startsAt: true },
    }),
    /*
     * Every completed visit from the start of the period onwards, because a
     * return can land after the period ends and still be a return. Bounding
     * this by the period would count every client seen in the last week of it
     * as churn.
     */
    db.appointment.findMany({
      where: { salonId, status: 'COMPLETED', startsAt: { gte: range.from } },
      select: { clientProfileId: true, primaryStylistId: true, startsAt: true },
    }),
    db.stylistProfile.findMany({
      where: { salonId },
      select: { id: true, displayName: true },
    }),
  ])

  const names = new Map(stylists.map((stylist) => [stylist.id, stylist.displayName]))
  const rates = rebookRates(toVisits(inPeriod), toVisits(everything), now)

  return rates.map((rate: RebookRate) => ({
    ...rate,
    displayName: names.get(rate.stylistProfileId) ?? 'Somebody who has left',
  }))
}

export interface FirstTimerAtRisk extends AtRisk {
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
  stylistName: string | null
}

/**
 * The clients a salon is about to lose without knowing it.
 *
 * A first visit that never became a second is the most expensive thing that
 * happens quietly in a salon: the acquisition is already paid for, the client
 * has no complaint on file, and nobody notices because nothing appears in a
 * diary to be missing.
 */
export async function firstTimerInterventions(
  salonId: string,
  now = new Date(),
): Promise<FirstTimerAtRisk[]> {
  const db = dbFor(salonId)

  /*
   * The window is applied in the query, not after the row cap.
   *
   * `take` without it takes 500 arbitrary one-visit clients and then filters
   * them by date — so a salon with a few thousand lapsed first-timers gets 500
   * rows from 2019 and an empty list, every day, with nothing to say why.
   */
  const oldest = new Date(now.getTime() - FIRST_TIMER_GRACE_DAYS * 3 * 86_400_000)
  const newest = new Date(now.getTime() - FIRST_TIMER_GRACE_DAYS * 86_400_000)

  const clients = await db.clientProfile.findMany({
    where: {
      salonId,
      status: 'ACTIVE',
      completedVisits: 1,
      firstVisitAt: { gte: oldest, lte: newest },
    },
    orderBy: { firstVisitAt: 'desc' },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      firstVisitAt: true,
      appointments: {
        where: { status: 'COMPLETED' },
        orderBy: { startsAt: 'asc' },
        take: 1,
        select: { primaryStylistId: true, primaryStylist: { select: { displayName: true } } },
      },
    },
    take: 500,
  })

  /*
   * Anything on the books counts as coming back, not just a completed visit. A
   * client with a booking next Thursday has not been lost, and putting them on
   * a "we are losing them" list is how a front desk learns to ignore it.
   */
  const upcoming = await db.appointment.findMany({
    where: {
      salonId,
      clientProfileId: { in: clients.map((client) => client.id) },
      status: { in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'] },
    },
    select: { clientProfileId: true },
    distinct: ['clientProfileId'],
  })

  const at = firstTimersAtRisk(
    clients.flatMap((client) =>
      client.firstVisitAt && client.appointments[0]
        ? [
            {
              clientProfileId: client.id,
              firstVisitAt: client.firstVisitAt,
              stylistProfileId: client.appointments[0].primaryStylistId,
            },
          ]
        : [],
    ),
    new Set(upcoming.map((row) => row.clientProfileId)),
    now,
  )

  const byId = new Map(clients.map((client) => [client.id, client]))
  return at.flatMap((risk) => {
    const client = byId.get(risk.clientProfileId)
    if (!client) return []
    return [
      {
        ...risk,
        firstName: client.firstName,
        lastName: client.lastName,
        phone: client.phone,
        email: client.email,
        stylistName: client.appointments[0]?.primaryStylist?.displayName ?? null,
      },
    ]
  })
}

// --- aftercare --------------------------------------------------------------

export interface AftercareInput {
  salonId: string
  appointmentId: string
  /** What to do at home, in the stylist's own words. */
  advice: string
  /** Products, with the reason each one was suggested. */
  products: readonly { retailProductId: string; reason: string | null }[]
  byUserId: string | null
}

/**
 * What to do with it once they leave.
 *
 * Two things at once, on purpose. The advice goes onto the client's timeline as
 * a real event, because the platform's whole hair record is an append-only
 * stream and a note that lives only on an appointment is a note nobody finds in
 * six weeks. The products go onto `ProductRecommendation` with the reason
 * attached — a recommendation without a reason is a sales target, and one with
 * a reason is aftercare.
 *
 * The reason is also what makes the number measurable afterwards: recommended
 * versus purchased is a real attachment rate, and it is only honest if the
 * recommendation was recorded at the moment it was made rather than inferred
 * from what was sold.
 */
export async function recordAftercare(input: AftercareInput): Promise<{ eventId: string }> {
  const db = dbFor(input.salonId)

  const appointment = await db.appointment.findFirst({
    where: { id: input.appointmentId, salonId: input.salonId },
    select: { id: true, clientProfileId: true, endsAt: true },
  })
  if (!appointment) throw new DomainError('NOT_FOUND', 'That appointment is not here.')

  const advice = input.advice.trim()
  if (advice === '' && input.products.length === 0) {
    throw new DomainError('INVALID_INPUT', 'There is nothing to save yet.')
  }

  return unsafeDb.$transaction(async (tx) => {
    const event = await tx.hairHistoryEvent.create({
      data: {
        salonId: input.salonId,
        clientProfileId: appointment.clientProfileId,
        occurredAt: appointment.endsAt,
        type: 'AT_HOME_TREATMENT',
        title: 'What to do at home',
        summary: advice === '' ? null : advice,
        appointmentId: appointment.id,
        source: 'STYLIST',
        createdByUserId: input.byUserId,
        // The client is the person it is for.
        isClientVisible: true,
      },
      select: { id: true },
    })

    for (const product of input.products) {
      await tx.productRecommendation.create({
        data: {
          salonId: input.salonId,
          clientProfileId: appointment.clientProfileId,
          appointmentId: appointment.id,
          retailProductId: product.retailProductId,
          recommendedByUserId: input.byUserId,
          reason: product.reason,
        },
      })
    }

    return { eventId: event.id }
  })
}

export async function aftercareFor(salonId: string, appointmentId: string) {
  const db = dbFor(salonId)

  const [event, recommendations] = await Promise.all([
    db.hairHistoryEvent.findFirst({
      where: { salonId, appointmentId, type: 'AT_HOME_TREATMENT' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, summary: true, occurredAt: true },
    }),
    db.productRecommendation.findMany({
      where: { salonId, appointmentId },
      select: {
        id: true,
        reason: true,
        status: true,
        retailProduct: { select: { id: true, name: true, brand: true, priceCents: true } },
      },
    }),
  ])

  return { advice: event?.summary ?? null, recommendations }
}

/**
 * How much of what was recommended was actually bought.
 *
 * Recommended versus purchased, and nothing else — no revenue attribution, no
 * per-stylist league table. The number is useful as a measure of whether the
 * aftercare conversation is happening at all; the moment it becomes a target it
 * stops measuring that.
 */
export async function attachmentRate(
  salonId: string,
  range: { from: Date; to: Date },
): Promise<{ recommended: number; purchased: number; rate: number | null }> {
  const db = dbFor(salonId)

  const rows = await db.productRecommendation.groupBy({
    by: ['status'],
    where: { salonId, createdAt: { gte: range.from, lt: range.to } },
    _count: { _all: true },
  })

  const recommended = rows.reduce((total, row) => total + row._count._all, 0)
  const purchased = rows.find((row) => row.status === 'PURCHASED')?._count._all ?? 0

  return { recommended, purchased, rate: recommended === 0 ? null : purchased / recommended }
}

// --- the nudges -------------------------------------------------------------

/**
 * Tell a client their colour is about due.
 *
 * `REBOOK_DUE` is the one trigger deliberately left out of `ALWAYS_SEND`, and
 * the reason still holds: a rebooking nudge is marketing, and sending one
 * nobody configured is putting words in the salon's mouth. So this materialises
 * and the send path decides — a salon with no schedule for it sends nothing,
 * and a client with no marketing consent is refused at the door.
 */
export async function nudgeRebookDue(
  salonId: string,
  now = new Date(),
): Promise<{ nudged: number }> {
  const db = dbFor(salonId)

  const window = REBOOK_WINDOW_DAYS * 86_400_000
  const due = await db.clientProfile.findMany({
    where: {
      salonId,
      status: 'ACTIVE',
      completedVisits: { gt: 0 },
      lastVisitAt: { lt: new Date(now.getTime() - window / 2), gt: new Date(now.getTime() - window) },
      // Somebody already booked in does not need telling.
      appointments: { none: { status: { in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'] } } },
    },
    select: { id: true, lastVisitAt: true },
    take: 200,
  })

  for (const client of due) {
    /*
     * The reference carries the visit it is about, not just the client.
     *
     * `materialiseNotification` dedupes on the ref id, so a bare client id
     * means a client can be nudged exactly once for the lifetime of their
     * account — the second time their colour is due, nothing happens, silently
     * and forever.
     */
    const anchor = client.lastVisitAt?.toISOString().slice(0, 10) ?? 'unknown'
    await materialiseNotification({
      salonId,
      trigger: 'REBOOK_DUE',
      refType: 'ClientProfile',
      refId: `${client.id}:${anchor}`,
      clientProfileId: client.id,
    })
  }

  return { nudged: due.length }
}

// --- internals --------------------------------------------------------------

function toVisits(
  rows: readonly { clientProfileId: string; primaryStylistId: string; startsAt: Date }[],
): Visit[] {
  return rows.map((row) => ({
    clientProfileId: row.clientProfileId,
    stylistProfileId: row.primaryStylistId,
    at: row.startsAt,
  }))
}
