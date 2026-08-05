import { createHash, createHmac } from 'node:crypto'
import { unsafeDb } from '@/server/db/client'
import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'

/**
 * "How is it sitting?", as one tap.
 *
 * A link rather than a reply. `MessageDirection.INBOUND` exists in the schema
 * and nothing has ever written one — a real reply channel needs another
 * provider webhook, a threading model, and somebody whose job is reading the
 * replies. A salon that asks a question it does not read has done worse than
 * not asking.
 *
 * Three buttons and an optional box. The ceiling on how much a client will type
 * on a phone three days after a haircut is very low, and a form that asks for a
 * paragraph gets nothing at all — while "not right" alone is already the whole
 * signal the salon needs to pick up the phone.
 */

/**
 * How long the link works.
 *
 * Two weeks. Long enough for somebody who reads their texts on Sunday, short
 * enough that a link forwarded or left in a message history does not stay live
 * indefinitely.
 */
const TTL_MS = 14 * 24 * 3_600_000

export type Sentiment = 'DELIGHTED' | 'FINE' | 'NOT_RIGHT'

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * The token, derived rather than drawn.
 *
 * An HMAC of the appointment id under the app secret, so it can be recomputed
 * whenever the message that carries it is (re)sent, while only its hash is ever
 * stored. A random token would have to be kept somewhere to survive a retried
 * send — and keeping it means the row IS the link, which is the thing hashing
 * was for.
 *
 * Rotating `AUTH_SECRET` invalidates every outstanding link. That is the
 * correct behaviour and worth knowing: the links are short-lived by design, and
 * a secret rotation should end them.
 */
function tokenFor(appointmentId: string): string {
  const secret = process.env.AUTH_SECRET ?? 'dev-only-secret-change-me-in-production'
  return createHmac('sha256', secret).update(`check-in:${appointmentId}`).digest('base64url')
}

/** The link to put in the message. Recomputable, so a retried send still works. */
export function checkInUrlFor(appointmentId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? ''
  return `${base}/c/${tokenFor(appointmentId)}`
}

/**
 * Mint one, or hand back the one that exists.
 *
 * Idempotent on the appointment, because the thing that calls it is an outbox
 * dispatch that can be retried — and two links to the same visit would mean the
 * client's answer depends on which text they happened to open.
 *
 * Only the hash is stored, so a leaked database is not a set of working links
 * into clients' feedback.
 */
export async function mintCheckIn(
  salonId: string,
  appointmentId: string,
  now = new Date(),
): Promise<{ token: string } | null> {
  const appointment = await unsafeDb.appointment.findFirst({
    where: { id: appointmentId, salonId },
    select: { id: true, clientProfileId: true },
  })
  if (!appointment) return null

  const token = tokenFor(appointmentId)
  await unsafeDb.postVisitCheckIn.upsert({
    where: { appointmentId },
    create: {
      salonId,
      appointmentId,
      clientProfileId: appointment.clientProfileId,
      tokenHash: hash(token),
      expiresAt: new Date(now.getTime() + TTL_MS),
    },
    // Deliberately nothing. A second call must not extend the window or wipe an
    // answer the client has already given.
    update: {},
  })

  return { token }
}

export interface CheckInView {
  salonId: string
  salonSlug: string
  salonName: string
  clientFirstName: string
  stylistName: string | null
  visitedAt: Date
  /** Already answered. The page still renders — it just says thank you. */
  respondedAt: Date | null
  sentiment: Sentiment | null
  expired: boolean
}

/**
 * Everything the page needs, from the token alone.
 *
 * A read, and only a read. Link previewers, email security scanners and
 * message-app unfurlers all issue a GET at any URL they see, so a check-in that
 * consumed itself on GET would be answered by a robot before the client ever
 * looked at it — and the client would then tap a page that says "thanks, you
 * already told us".
 */
export async function checkInByToken(token: string, now = new Date()): Promise<CheckInView | null> {
  const row = await unsafeDb.postVisitCheckIn.findUnique({
    where: { tokenHash: hash(token) },
    select: {
      salonId: true,
      respondedAt: true,
      sentiment: true,
      expiresAt: true,
      salon: { select: { slug: true, name: true } },
      clientProfile: { select: { firstName: true } },
      appointment: {
        select: { startsAt: true, primaryStylist: { select: { displayName: true } } },
      },
    },
  })
  if (!row) return null

  return {
    salonId: row.salonId,
    salonSlug: row.salon.slug,
    salonName: row.salon.name,
    clientFirstName: row.clientProfile.firstName,
    stylistName: row.appointment.primaryStylist?.displayName ?? null,
    visitedAt: row.appointment.startsAt,
    respondedAt: row.respondedAt,
    sentiment: row.sentiment,
    expired: row.expiresAt.getTime() < now.getTime(),
  }
}

/**
 * Record the answer.
 *
 * Asserts the salon explicitly. `PublicContext` carries no scoped Prisma client
 * — unlike `TenantContext`, which has one from `dbFor` — so nothing here is
 * narrowed for us, and the slug in the URL is whatever the caller typed. A
 * token from one salon replayed against another's slug must find nothing.
 */
export async function respondToCheckIn(input: {
  salonId: string
  token: string
  sentiment: Sentiment
  note: string | null
  now?: Date
}): Promise<{ recorded: boolean }> {
  const now = input.now ?? new Date()

  const row = await unsafeDb.postVisitCheckIn.findUnique({
    where: { tokenHash: hash(input.token) },
    select: { id: true, salonId: true, expiresAt: true, respondedAt: true },
  })
  if (!row || row.salonId !== input.salonId) {
    throw new DomainError('NOT_FOUND', 'That link is not one of ours.')
  }
  if (row.expiresAt.getTime() < now.getTime()) {
    throw new DomainError('CONFLICT', 'That link has expired. Call us and we will sort it out.')
  }

  /*
   * A second tap is not an error and not an overwrite. Somebody double-tapping
   * on a phone should see a thank-you, and somebody coming back a week later to
   * change their mind should ring the salon rather than silently rewriting what
   * the salon already acted on.
   */
  if (row.respondedAt) return { recorded: false }

  await unsafeDb.postVisitCheckIn.update({
    where: { id: row.id },
    data: {
      respondedAt: now,
      sentiment: input.sentiment,
      note: input.note?.trim() || null,
    },
  })

  return { recorded: true }
}

/**
 * The ones somebody needs to do something about.
 *
 * Only NOT_RIGHT, and only unresolved. A list that also contained the happy
 * ones would be a feed to scroll rather than a queue to clear, and the entire
 * value of a 72-hour window is that somebody acts inside it.
 */
export async function unhappyCheckIns(salonId: string) {
  const db = dbFor(salonId)
  return db.postVisitCheckIn.findMany({
    where: { salonId, sentiment: 'NOT_RIGHT', resolvedAt: null },
    orderBy: { respondedAt: 'asc' },
    take: 50,
    select: {
      id: true,
      note: true,
      respondedAt: true,
      clientProfile: { select: { id: true, firstName: true, lastName: true, phone: true } },
      appointment: {
        select: { id: true, startsAt: true, primaryStylist: { select: { displayName: true } } },
      },
    },
  })
}

export async function resolveCheckIn(
  salonId: string,
  checkInId: string,
  byUserId: string | null,
): Promise<void> {
  const db = dbFor(salonId)
  await db.postVisitCheckIn.updateMany({
    where: { id: checkInId, salonId },
    data: { resolvedAt: new Date(), resolvedByUserId: byUserId },
  })
}
