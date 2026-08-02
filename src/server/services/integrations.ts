import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import { calendarPort } from '@/ports/registry'
import { buildIcsFeed } from '@/ports/calendar'
import { dayBounds } from './front-desk'

/**
 * Talking to the outside world.
 *
 * Three shapes, in increasing order of how much can go wrong:
 *
 *  - A subscribable calendar feed. No account, no OAuth, no sync loop — a URL
 *    a stylist pastes into their phone. It covers most of what people actually
 *    want from "calendar integration" and cannot break the salon's data.
 *  - Two-way calendar sync through the port, for salons that want their
 *    external commitments respected by the solver.
 *  - Outbound webhooks, for anything else.
 *
 * A failing integration never blocks a booking. Everything here is either read
 * only, or driven off the job queue where a retry is free — a salon should not
 * be unable to take a client's money because somebody's Google token expired.
 */

// --- Subscribable feed --------------------------------------------------------

/**
 * A stylist's own feed token.
 *
 * Random and per-stylist, so a leaked URL exposes one person's diary rather
 * than the salon's, and rotating it is a single row update. Only the hash is
 * stored: a feed URL is a bearer credential, and a database dump should not
 * hand out working ones.
 */
export async function issueFeedToken(
  salonId: string,
  stylistProfileId: string,
): Promise<{ token: string; url: string }> {
  const token = randomBytes(24).toString('base64url')

  await unsafeDb.integrationConnection.upsert({
    where: {
      salonId_provider_stylistProfileId: {
        salonId,
        provider: 'APPLE_ICAL',
        stylistProfileId,
      },
    },
    create: {
      salonId,
      provider: 'APPLE_ICAL',
      stylistProfileId,
      settingsJson: { tokenHash: hashToken(token) },
      isActive: true,
    },
    update: {
      settingsJson: { tokenHash: hashToken(token) },
      isActive: true,
      lastError: null,
    },
  })

  return { token, url: `/api/calendar/${stylistProfileId}.ics?token=${token}` }
}

export async function revokeFeedToken(salonId: string, stylistProfileId: string): Promise<void> {
  await unsafeDb.integrationConnection.updateMany({
    where: { salonId, provider: 'APPLE_ICAL', stylistProfileId },
    data: { isActive: false, settingsJson: {} },
  })
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Resolve a feed request.
 *
 * Constant-time comparison, and a wrong token is indistinguishable from an
 * unknown stylist — a different response for each would confirm which stylist
 * ids exist.
 */
export async function feedFor(
  stylistProfileId: string,
  token: string,
): Promise<{ ics: string } | null> {
  const connection = await unsafeDb.integrationConnection.findFirst({
    where: { provider: 'APPLE_ICAL', stylistProfileId, isActive: true },
    select: { salonId: true, settingsJson: true },
  })
  if (!connection) return null

  const expected = (connection.settingsJson as { tokenHash?: string } | null)?.tokenHash
  if (!expected || !constantTimeEquals(expected, hashToken(token))) return null

  const stylist = await unsafeDb.stylistProfile.findFirst({
    where: { id: stylistProfileId, salonId: connection.salonId },
    select: { displayName: true, salon: { select: { name: true } } },
  })
  if (!stylist) return null

  /*
   * A rolling window rather than everything: a calendar client re-fetches this
   * constantly, and a feed that grows without bound gets slower every month
   * until somebody's phone quietly stops refreshing it.
   */
  const from = new Date(Date.now() - 7 * 86_400_000)
  const to = new Date(Date.now() + 90 * 86_400_000)

  const appointments = await unsafeDb.appointment.findMany({
    where: {
      salonId: connection.salonId,
      primaryStylistId: stylistProfileId,
      startsAt: { gte: from, lt: to },
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
    },
    orderBy: { startsAt: 'asc' },
    include: {
      clientProfile: { select: { firstName: true, lastName: true } },
      services: { include: { service: { select: { name: true } } } },
      location: { select: { name: true } },
    },
  })

  const ics = buildIcsFeed(
    `${stylist.salon.name} — ${stylist.displayName}`,
    appointments.map((appointment) => ({
      reference: appointment.id,
      title: `${appointment.clientProfile.firstName} ${(appointment.clientProfile.lastName ?? '').charAt(0)}. — ${appointment.services.map((s) => s.service.name).join(' + ')}`,
      description: appointment.clientNote ?? undefined,
      location: appointment.location.name,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
    })),
  )

  return { ics }
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

// --- Two-way calendar ---------------------------------------------------------

/**
 * Push one appointment out to a connected calendar.
 *
 * Never called inline from booking. It runs off the job queue, so a provider
 * being down delays a calendar entry rather than failing a booking — and a
 * salon is never unable to take money because somebody's token expired.
 */
export async function pushAppointment(input: {
  salonId: string
  appointmentId: string
}): Promise<{ pushed: boolean }> {
  const appointment = await unsafeDb.appointment.findFirst({
    where: { id: input.appointmentId, salonId: input.salonId },
    include: {
      clientProfile: { select: { firstName: true, lastName: true } },
      services: { include: { service: { select: { name: true } } } },
      location: { select: { name: true } },
    },
  })
  if (!appointment) return { pushed: false }

  const connection = await unsafeDb.integrationConnection.findFirst({
    where: {
      salonId: input.salonId,
      provider: 'GOOGLE_CALENDAR',
      isActive: true,
      OR: [{ stylistProfileId: appointment.primaryStylistId }, { stylistProfileId: null }],
    },
    orderBy: { stylistProfileId: 'desc' },
  })
  if (!connection?.externalAccountId) return { pushed: false }

  try {
    await calendarPort().push(connection.externalAccountId, {
      reference: appointment.id,
      // Initial only. A salon's calendar entry syncing full client names into
      // a personal Google account is a privacy problem nobody asked for.
      title: `${appointment.clientProfile.firstName} ${(appointment.clientProfile.lastName ?? '').charAt(0)}.`,
      description: appointment.services.map((s) => s.service.name).join(' + '),
      location: appointment.location.name,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
    })

    await unsafeDb.integrationConnection.update({
      where: { id: connection.id },
      data: { lastSyncedAt: new Date(), lastError: null },
    })
    return { pushed: true }
  } catch (err) {
    // Recorded, not thrown. The connection screen shows the failure; the
    // booking it came from is already safe in the database.
    await unsafeDb.integrationConnection.update({
      where: { id: connection.id },
      data: { lastError: (err as Error).message.slice(0, 500) },
    })
    return { pushed: false }
  }
}

/**
 * External commitments the salon does not know about.
 *
 * Fetched so the availability solver can avoid them. Returns nothing on
 * failure rather than throwing: a stylist whose calendar is unreachable should
 * still be bookable on the hours the salon does know about, not disappear from
 * the diary.
 */
export async function externalBusy(input: {
  salonId: string
  stylistProfileId: string
  localDate: string
  timeZone: string
}): Promise<{ startsAt: Date; endsAt: Date }[]> {
  const connection = await unsafeDb.integrationConnection.findFirst({
    where: {
      salonId: input.salonId,
      provider: 'GOOGLE_CALENDAR',
      stylistProfileId: input.stylistProfileId,
      isActive: true,
    },
  })
  if (!connection?.externalAccountId) return []

  const { from, to } = dayBounds(input.localDate, input.timeZone)

  try {
    return await calendarPort().pullBusy(connection.externalAccountId, from, to)
  } catch {
    return []
  }
}

// --- Outbound webhooks ---------------------------------------------------------

export type WebhookTopic =
  | 'appointment.booked'
  | 'appointment.cancelled'
  | 'appointment.completed'
  | 'consultation.submitted'
  | 'consultation.approved'
  | 'payment.captured'

/**
 * Sign a webhook body.
 *
 * Timestamped and signed over both, so a receiver can reject a replayed
 * request. Same scheme every major provider uses, for the same reason: a
 * signature over the body alone is valid forever.
 */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  return createHash('sha256').update(`${timestamp}.${body}.${secret}`).digest('hex')
}

export function verifyWebhook(input: {
  secret: string
  body: string
  timestamp: number
  signature: string
  toleranceSeconds?: number
  now?: number
}): boolean {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const tolerance = input.toleranceSeconds ?? 300

  if (Math.abs(now - input.timestamp) > tolerance) return false

  return constantTimeEquals(signWebhook(input.secret, input.body, input.timestamp), input.signature)
}

/**
 * Queue an outbound webhook.
 *
 * Through the job queue, so delivery retries with backoff and a receiver being
 * down is their problem rather than the salon's. Nothing here calls out
 * inline; a booking must never wait on somebody else's endpoint.
 */
export async function emitWebhook(input: {
  salonId: string
  topic: WebhookTopic
  payload: Record<string, unknown>
}): Promise<void> {
  await unsafeDb.outbox.create({
    data: {
      salonId: input.salonId,
      topic: input.topic,
      payloadJson: input.payload as never,
    },
  })
}

// --- Connection management -----------------------------------------------------

export async function listConnections(salonId: string) {
  const connections = await unsafeDb.integrationConnection.findMany({
    where: { salonId },
    orderBy: [{ provider: 'asc' }, { createdAt: 'asc' }],
  })

  const stylists = await unsafeDb.stylistProfile.findMany({
    where: { salonId },
    select: { id: true, displayName: true },
  })
  const names = new Map(stylists.map((s) => [s.id, s.displayName]))

  return connections.map((connection) => ({
    id: connection.id,
    provider: connection.provider,
    scope: connection.stylistProfileId
      ? (names.get(connection.stylistProfileId) ?? 'A stylist')
      : 'Whole salon',
    isActive: connection.isActive,
    lastSyncedAt: connection.lastSyncedAt,
    lastError: connection.lastError,
    // Never the token itself, hashed or otherwise.
    hasCredentials: Boolean(connection.accessToken || connection.externalAccountId),
  }))
}

export async function disconnect(salonId: string, connectionId: string): Promise<void> {
  const connection = await unsafeDb.integrationConnection.findFirst({
    where: { id: connectionId, salonId },
    select: { id: true },
  })
  if (!connection) throw new DomainError('NOT_FOUND', 'That connection no longer exists.')

  /*
   * Cleared, not just deactivated. Leaving a revoked provider's tokens in the
   * database is how a "disconnected" integration turns out to still have
   * working credentials months later.
   */
  await unsafeDb.integrationConnection.update({
    where: { id: connection.id },
    data: {
      isActive: false,
      accessToken: null,
      refreshToken: null,
      syncToken: null,
      settingsJson: {},
      lastError: null,
    },
  })
}
