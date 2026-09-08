import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { unsafeDb } from '@/server/db/client'
import { dbFor } from '@/server/db/tenant-client'
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
  const db = dbFor(salonId)
  const token = randomBytes(24).toString('base64url')

  await db.integrationConnection.upsert({
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
  const db = dbFor(salonId)
  await db.integrationConnection.updateMany({
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

  const db = dbFor(connection.salonId)
  const stylist = await db.stylistProfile.findFirst({
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

  const appointments = await db.appointment.findMany({
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
  const db = dbFor(input.salonId)
  const appointment = await db.appointment.findFirst({
    where: { id: input.appointmentId, salonId: input.salonId },
    include: {
      clientProfile: { select: { firstName: true, lastName: true } },
      services: { include: { service: { select: { name: true } } } },
      location: { select: { name: true } },
    },
  })
  if (!appointment) return { pushed: false }

  const connection = await db.integrationConnection.findFirst({
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

    await db.integrationConnection.update({
      where: { id: connection.id },
      data: { lastSyncedAt: new Date(), lastError: null },
    })
    return { pushed: true }
  } catch (err) {
    // Recorded, not thrown. The connection screen shows the failure; the
    // booking it came from is already safe in the database.
    await db.integrationConnection.update({
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
  const db = dbFor(input.salonId)
  const connection = await db.integrationConnection.findFirst({
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

/** After this many consecutive failures an endpoint stops being tried. */
const DEAD_AFTER_FAILURES = 20

/**
 * Queue an outbound webhook to every endpoint that wants this topic.
 *
 * This used to write an `Outbox` row, which was wrong twice over: nothing
 * delivered it anywhere, and `Outbox` is the salon's own notification pipeline,
 * so calling it would have double-fired the client-facing messages that
 * `outboxDispatch` materialises from the same topic names.
 *
 * One `WebhookDelivery` row per endpoint, written here and posted by the job.
 * Recorded rather than fire-and-forget, because "we sent it" is a claim a salon
 * will have to make to whoever is on the other end, and an unlogged POST cannot
 * support it.
 */
export async function emitWebhook(input: {
  salonId: string
  topic: WebhookTopic
  payload: Record<string, unknown>
  /** Stable id for this emission (usually the outbox row id). */
  dedupeKey?: string | null
}): Promise<{ queued: number }> {
  const db = dbFor(input.salonId)
  const endpoints = await db.webhookEndpoint.findMany({
    where: {
      salonId: input.salonId,
      isActive: true,
      failureCount: { lt: DEAD_AFTER_FAILURES },
    },
    select: { id: true, topics: true },
  })

  // An empty topic list means everything. Named topics mean only those.
  const wanted = endpoints.filter(
    (endpoint) => endpoint.topics.length === 0 || endpoint.topics.includes(input.topic),
  )
  if (wanted.length === 0) return { queued: 0 }

  await db.webhookDelivery.createMany({
    data: wanted.map((endpoint) => ({
      salonId: input.salonId,
      endpointId: endpoint.id,
      topic: input.topic,
      payloadJson: input.payload as never,
      dedupeKey: input.dedupeKey ?? null,
    })),
    // A retried outbox.dispatch must not enqueue a second delivery per endpoint.
    skipDuplicates: true,
  })

  return { queued: wanted.length }
}

/**
 * Post what is waiting.
 *
 * Run from the job queue on a timer. Failures are recorded against the
 * endpoint and the delivery rather than thrown: one salon's broken URL must not
 * stop another salon's events going out, and the sweep runs again in a minute.
 */
export async function deliverWebhooks(limit = 50): Promise<{ sent: number; failed: number }> {
  const pending = await unsafeDb.webhookDelivery.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { endpoint: true },
  })

  let sent = 0
  let failed = 0

  for (const delivery of pending) {
    const endpoint = delivery.endpoint
    const db = dbFor(delivery.salonId)
    if (!endpoint.isActive || endpoint.failureCount >= DEAD_AFTER_FAILURES) {
      await db.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          error: 'The endpoint is switched off or has failed too many times.',
          attempts: { increment: 1 },
        },
      })
      failed += 1
      continue
    }

    const timestamp = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({
      id: delivery.id,
      topic: delivery.topic,
      createdAt: delivery.createdAt.toISOString(),
      data: delivery.payloadJson,
    })

    try {
      // Re-check at delivery time — an endpoint URL must not become an open
      // proxy into the private network after DNS changes.
      await assertPublicHttpsTarget(new URL(endpoint.url))

      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          /*
           * Timestamp and signature as separate headers, over both values. A
           * signature over the body alone is valid forever, so a request
           * captured once can be replayed indefinitely.
           */
          'x-salon-timestamp': String(timestamp),
          'x-salon-signature': signWebhook(endpoint.secret, body, timestamp),
          'x-salon-topic': delivery.topic,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      })

      if (response.ok) {
        await db.$transaction([
          db.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'DELIVERED',
              responseCode: response.status,
              deliveredAt: new Date(),
              attempts: { increment: 1 },
              error: null,
            },
          }),
          db.webhookEndpoint.update({
            where: { id: endpoint.id },
            data: { lastDeliveredAt: new Date(), lastError: null, failureCount: 0 },
          }),
        ])
        sent += 1
        continue
      }

      await recordFailure(
        delivery.salonId,
        delivery.id,
        endpoint.id,
        `HTTP ${response.status}`,
        response.status,
      )
      failed += 1
    } catch (err) {
      await recordFailure(
        delivery.salonId,
        delivery.id,
        endpoint.id,
        (err as Error).message.slice(0, 500),
        null,
      )
      failed += 1
    }
  }

  return { sent, failed }
}

/**
 * A delivery that did not land.
 *
 * Left PENDING below the attempt ceiling so the next sweep tries again; a
 * receiver being briefly down is the ordinary case and should not need anybody
 * to do anything.
 */
async function recordFailure(
  salonId: string,
  deliveryId: string,
  endpointId: string,
  message: string,
  code: number | null,
): Promise<void> {
  const db = dbFor(salonId)
  const delivery = await db.webhookDelivery.update({
    where: { id: deliveryId },
    data: { attempts: { increment: 1 }, error: message, responseCode: code },
    select: { attempts: true },
  })

  await db.webhookEndpoint.update({
    where: { id: endpointId },
    data: { lastError: message, failureCount: { increment: 1 } },
  })

  if (delivery.attempts >= 8) {
    await db.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'FAILED' },
    })
  }
}

// --- Endpoint management -------------------------------------------------------

export const WEBHOOK_TOPICS: readonly WebhookTopic[] = [
  'appointment.booked',
  'appointment.cancelled',
  'appointment.completed',
  'consultation.submitted',
  'consultation.approved',
  'payment.captured',
]

/**
 * Register a URL.
 *
 * The secret is minted here and returned exactly once. It is stored in the
 * clear because a signature the receiver can verify requires both sides to
 * hold the same value — unlike a feed token, it cannot be a one-way hash.
 * Everywhere else it is treated as a credential: never listed, never re-shown.
 */
export async function addEndpoint(input: {
  salonId: string
  url: string
  topics: WebhookTopic[]
}): Promise<{ id: string; secret: string }> {
  const db = dbFor(input.salonId)
  let parsed: URL
  try {
    parsed = new URL(input.url)
  } catch {
    throw new DomainError('INVALID_INPUT', 'That does not look like a web address.')
  }

  /*
   * HTTPS only. A signed payload sent over plain HTTP is signed and readable,
   * which defeats the point of signing it — and these carry client names.
   */
  if (parsed.protocol !== 'https:') {
    throw new DomainError('INVALID_INPUT', 'The address has to start with https.')
  }

  await assertPublicHttpsTarget(parsed)

  const secret = `whsec_${randomBytes(24).toString('base64url')}`

  const endpoint = await db.webhookEndpoint.create({
    data: {
      salonId: input.salonId,
      url: parsed.toString(),
      secret,
      topics: input.topics,
    },
    select: { id: true },
  })

  return { id: endpoint.id, secret }
}

/** Block private / link-local / metadata targets (SSRF). Fail closed on DNS errors. */
export async function assertPublicHttpsTarget(parsed: URL): Promise<void> {
  if (parsed.protocol !== 'https:') {
    throw new DomainError('INVALID_INPUT', 'The address has to start with https.')
  }
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new DomainError('INVALID_INPUT', 'That address is not reachable from here.')
  }

  const literal = isIP(host)
  if (literal && isPrivateIp(host)) {
    throw new DomainError('INVALID_INPUT', 'That address is not reachable from here.')
  }

  if (!literal) {
    // Test sandboxes often have no working DNS. Hostname/literal checks above
    // still catch localhost and private IP strings; resolve in real runtimes.
    if (process.env.NODE_ENV === 'test') return

    let records: { address: string; family: number }[]
    try {
      records = await lookup(host, { all: true, verbatim: true })
    } catch {
      throw new DomainError('INVALID_INPUT', 'That address could not be resolved.')
    }
    if (records.length === 0 || records.some((r) => isPrivateIp(r.address))) {
      throw new DomainError('INVALID_INPUT', 'That address is not reachable from here.')
    }
  }
}

function isPrivateIp(address: string): boolean {
  const v4 = address.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }
  const normalised = address.toLowerCase()
  if (normalised === '::1' || normalised === '0:0:0:0:0:0:0:1') return true
  if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true // ULA
  if (normalised.startsWith('fe80')) return true // link-local
  return false
}

export async function removeEndpoint(salonId: string, endpointId: string): Promise<void> {
  const db = dbFor(salonId)
  const endpoint = await db.webhookEndpoint.findFirst({
    where: { id: endpointId, salonId },
    select: { id: true },
  })
  if (!endpoint) throw new DomainError('NOT_FOUND', 'That endpoint no longer exists.')

  await db.webhookEndpoint.delete({ where: { id: endpoint.id } })
}

/** What is registered, and how it has been behaving. Never the secret. */
export async function listEndpoints(salonId: string) {
  const db = dbFor(salonId)
  const endpoints = await db.webhookEndpoint.findMany({
    where: { salonId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      url: true,
      topics: true,
      isActive: true,
      lastDeliveredAt: true,
      lastError: true,
      failureCount: true,
      _count: { select: { deliveries: true } },
    },
  })

  return endpoints.map((endpoint) => ({
    ...endpoint,
    deliveries: endpoint._count.deliveries,
    // Said plainly, because an endpoint that has quietly stopped being tried
    // looks identical to one that is working until somebody goes looking.
    dead: endpoint.failureCount >= DEAD_AFTER_FAILURES,
  }))
}

// --- Mirroring an external calendar --------------------------------------------

/** How far ahead a pull looks. Beyond this the diary is mostly empty anyway. */
const SYNC_DAYS = 21

/**
 * Copy a stylist's outside commitments in, so the solver can avoid them.
 *
 * `externalBusy` was written to be called from the availability solver, and
 * doing that would have put somebody else's server in the booking hot path:
 * every slot search would wait on Google, and a slow token refresh would read
 * to a client as "this salon has nothing free". Mirrored on a timer instead,
 * into rows the loader already knows how to treat as blocked time.
 *
 * Rows are replaced per (stylist, source) rather than cleared wholesale, so two
 * connections for one stylist cannot delete each other's work.
 */
export async function syncExternalBusy(input: {
  salonId: string
  stylistProfileId: string
  timeZone: string
  days?: number
  today?: string
}): Promise<{ mirrored: number }> {
  const db = dbFor(input.salonId)
  const days = input.days ?? SYNC_DAYS
  const start = input.today ?? new Date().toISOString().slice(0, 10)
  const source = `google:${input.stylistProfileId}`

  const intervals: { startsAt: Date; endsAt: Date }[] = []
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(`${start}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + offset)
    const localDate = date.toISOString().slice(0, 10)

    intervals.push(
      ...(await externalBusy({
        salonId: input.salonId,
        stylistProfileId: input.stylistProfileId,
        localDate,
        timeZone: input.timeZone,
      })),
    )
  }

  await db.$transaction([
    db.externalBusy.deleteMany({ where: { salonId: input.salonId, source } }),
    db.externalBusy.createMany({
      data: intervals.map((interval) => ({
        salonId: input.salonId,
        stylistProfileId: input.stylistProfileId,
        startsAt: interval.startsAt,
        endsAt: interval.endsAt,
        source,
      })),
    }),
  ])

  return { mirrored: intervals.length }
}

// --- Connection management -----------------------------------------------------

export async function listConnections(salonId: string) {
  const db = dbFor(salonId)
  const connections = await db.integrationConnection.findMany({
    where: { salonId },
    orderBy: [{ provider: 'asc' }, { createdAt: 'asc' }],
  })

  const stylists = await db.stylistProfile.findMany({
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
  const db = dbFor(salonId)
  const connection = await db.integrationConnection.findFirst({
    where: { id: connectionId, salonId },
    select: { id: true },
  })
  if (!connection) throw new DomainError('NOT_FOUND', 'That connection no longer exists.')

  /*
   * Cleared, not just deactivated. Leaving a revoked provider's tokens in the
   * database is how a "disconnected" integration turns out to still have
   * working credentials months later.
   */
  await db.integrationConnection.update({
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
