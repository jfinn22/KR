import { z } from 'zod'
import { unsafeDb } from '@/server/db/client'
import { emailPort, smsPort, storagePort } from '@/ports/registry'
import { assessPhoto } from '@/domain/hair/photo-quality'
import { installOutboxSink } from '@/server/outbox-sink'
import { enqueue } from './queue'
import type { NotificationTrigger } from '@prisma/client'
import { DEFAULT_COPY, materialiseNotification } from '@/server/services/notifications'

/**
 * How long a finished import's source file survives.
 *
 * Seven days, counted from completion: long enough for an owner to come back
 * on Monday and re-run something that went wrong on Friday, short enough that
 * a salon's whole client list is not sitting in object storage indefinitely.
 */
const IMPORT_FILE_RETENTION_MS = 7 * 24 * 3_600_000

/**
 * Job handlers.
 *
 * Each declares a zod schema for its payload, so a malformed job fails loudly
 * at claim time rather than half-executing. Handlers are ordinary async
 * functions — nothing here knows it is running in a worker.
 */

export interface JobDefinition<T> {
  schema: z.ZodType<T>
  timeoutMs: number
  maxAttempts: number
  handler: (payload: T) => Promise<void>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJobDefinition = JobDefinition<any>

const define = <T>(def: JobDefinition<T>): AnyJobDefinition => def

// ---------------------------------------------------------------------------

/**
 * Drain the transactional outbox.
 *
 * Domain writes commit an Outbox row alongside themselves; this turns those
 * rows into jobs. That is why a booking confirmation is never lost because a
 * provider happened to be down at the moment of commit.
 */
/**
 * Which outbox topics become a client-facing notification, and as what.
 *
 * A table rather than a chain of ifs, because the next six triggers are all
 * the same shape — and the reason approval notified nobody is that adding a
 * seventh `if` was nobody's idea of a Tuesday.
 */
const NOTIFY_TOPICS: Record<
  string,
  { trigger: NotificationTrigger; refType: string; refKey: string; clientKey: string }
> = {
  'consultation.approved': {
    trigger: 'CONSULT_DECISION',
    refType: 'Consultation',
    refKey: 'consultationId',
    clientKey: 'clientProfileId',
  },
  /*
   * After the appointment, not before it.
   *
   * `APPOINTMENT_AFTER` has had finished copy since the schema was written —
   * "How is it sitting?" — and nothing has ever created one. The window it
   * opens is the point of it: a client who says on Thursday that the tone went
   * brassy can be put right on Saturday, and one who says it in six weeks has
   * already told three friends.
   */
  'appointment.completed': {
    trigger: 'APPOINTMENT_AFTER',
    refType: 'Appointment',
    refKey: 'appointmentId',
    clientKey: 'clientProfileId',
  },
}

/**
 * Triggers whose message is the salon's marketing rather than the service.
 * Everything else is transactional: the client asked for the thing the message
 * is about, so silence is not a reason to withhold it.
 */
const MARKETING_TRIGGERS: ReadonlySet<NotificationTrigger | null> = new Set([
  'REBOOK_DUE',
] as NotificationTrigger[])

const outboxDispatch = define({
  schema: z.object({}).passthrough(),
  timeoutMs: 30_000,
  maxAttempts: 10,
  handler: async () => {
    const pending = await unsafeDb.outbox.findMany({
      where: { publishedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })

    for (const event of pending) {
      const topic = event.topic
      const payload = (event.payloadJson ?? {}) as Record<string, unknown>

      if (topic === 'appointment.booked') {
        await enqueue({
          type: 'notification.materialize',
          salonId: event.salonId,
          payload,
          dedupeKey: `materialize:${payload.appointmentId}`,
        })
      }
      if (topic === 'appointment.cancelled') {
        await enqueue({
          type: 'waitlist.match',
          salonId: event.salonId,
          payload,
          dedupeKey: `waitlist:${payload.appointmentId}`,
        })
      }

      /*
       * Everything else that should reach a client goes through the generic
       * materialiser. Before this, `consultation.approved` was emitted, fell
       * through both branches above, and was marked published — so approving a
       * plan told the client nothing at all, and the only way they found out
       * was returning to the site and noticing a card.
       */
      /*
       * The one-tap link, minted before the notification that carries it.
       *
       * Idempotent on the appointment, because this dispatch can be retried and
       * two links to one visit means the client's answer depends on which text
       * they happened to open.
       */
      if (topic === 'appointment.completed' && event.salonId) {
        const { mintCheckIn } = await import('@/server/services/check-in')
        if (typeof payload.appointmentId === 'string') {
          await mintCheckIn(event.salonId, payload.appointmentId)
        }
      }

      const notify = NOTIFY_TOPICS[topic]
      if (notify && event.salonId) {
        const clientProfileId = payload[notify.clientKey]
        const refId = payload[notify.refKey]
        if (typeof clientProfileId === 'string' && typeof refId === 'string') {
          await materialiseNotification({
            salonId: event.salonId,
            trigger: notify.trigger,
            refType: notify.refType,
            refId,
            clientProfileId,
          })
        }
      }

      await unsafeDb.outbox.update({
        where: { id: event.id },
        data: { publishedAt: new Date(), attempts: { increment: 1 } },
      })
    }
  },
})

/**
 * Release holds that have timed out.
 *
 * An exclusion constraint cannot reference now(), so an expired hold keeps
 * physically blocking its slot until something deletes the segments. Booking
 * also purges opportunistically, so a stalled worker cannot strand a slot.
 */
const holdExpire = define({
  schema: z.object({}).passthrough(),
  timeoutMs: 30_000,
  maxAttempts: 3,
  handler: async () => {
    const now = new Date()
    const expired = await unsafeDb.bookingHold.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now } },
      select: { id: true },
      take: 500,
    })
    if (expired.length === 0) return

    const ids = expired.map((h) => h.id)
    await unsafeDb.appointmentSegment.deleteMany({ where: { bookingHoldId: { in: ids } } })
    await unsafeDb.bookingHold.updateMany({
      where: { id: { in: ids } },
      data: { status: 'EXPIRED' },
    })
  },
})

/** Turn a salon's reminder schedule into concrete, dated sends. */
const notificationMaterialize = define({
  schema: z.object({ appointmentId: z.string() }),
  timeoutMs: 30_000,
  maxAttempts: 5,
  handler: async ({ appointmentId }) => {
    const appointment = await unsafeDb.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, salonId: true, clientProfileId: true, startsAt: true, status: true },
    })
    if (!appointment || appointment.status === 'CANCELLED') return

    const schedules = await unsafeDb.notificationSchedule.findMany({
      where: { salonId: appointment.salonId, isEnabled: true, trigger: 'APPOINTMENT_BEFORE' },
    })

    for (const schedule of schedules) {
      const sendAt = new Date(appointment.startsAt.getTime() + schedule.offsetMinutes * 60_000)
      if (sendAt <= new Date()) continue

      const dedupeKey = `notify:${appointment.id}:${schedule.key}`
      await unsafeDb.scheduledNotification.upsert({
        where: { dedupeKey },
        create: {
          salonId: appointment.salonId,
          scheduleId: schedule.id,
          clientProfileId: appointment.clientProfileId,
          refType: 'Appointment',
          refId: appointment.id,
          channel: schedule.channel,
          sendAt,
          dedupeKey,
        },
        update: { sendAt, cancelledAt: null },
      })

      await enqueue({
        type: 'notification.send',
        salonId: appointment.salonId,
        payload: { dedupeKey },
        runAt: sendAt,
        dedupeKey: `send:${dedupeKey}`,
      })
    }
  },
})

/**
 * Send one scheduled notification.
 *
 * Consent and suppression are checked HERE, at send time — a client who opts
 * out on Tuesday must not receive Monday's already-queued reminder.
 */
const notificationSend = define({
  schema: z.object({ dedupeKey: z.string() }),
  timeoutMs: 30_000,
  maxAttempts: 5,
  handler: async ({ dedupeKey }) => {
    installOutboxSink()

    const scheduled = await unsafeDb.scheduledNotification.findUnique({
      where: { dedupeKey },
      include: {
        clientProfile: { select: { id: true, firstName: true, email: true, phone: true } },
        schedule: { include: { template: true } },
      },
    })
    if (!scheduled || scheduled.cancelledAt || scheduled.status === 'SENT') return

    const channel = scheduled.channel
    const address =
      channel === 'SMS' ? scheduled.clientProfile.phone : scheduled.clientProfile.email
    if (!address) return

    /*
     * Consent, with the purpose the message actually has.
     *
     * Two things were wrong here. The purpose was hardcoded to TRANSACTIONAL,
     * so a marketing send was checked against transactional permission — the
     * wrong question. And the test was `consent && status === 'REVOKED'`, so an
     * ABSENT row passed: a client with no consent record at all received
     * whatever was queued.
     *
     * The fix is not simply "require a GRANTED row", because the two purposes
     * genuinely differ. Somebody who booked an appointment expects to be told
     * about it, and a walk-in the front desk created has no consent row through
     * no fault of theirs — so absent is allowed for TRANSACTIONAL. Marketing is
     * the opposite: silence is not permission, so absent blocks.
     */
    const purpose = MARKETING_TRIGGERS.has(scheduled.trigger ?? scheduled.schedule?.trigger ?? null)
      ? 'MARKETING'
      : 'TRANSACTIONAL'

    const consent = await unsafeDb.contactConsent.findUnique({
      where: {
        clientProfileId_channel_purpose: {
          clientProfileId: scheduled.clientProfileId,
          channel,
          purpose,
        },
      },
    })

    const permitted =
      purpose === 'TRANSACTIONAL' ? consent?.status !== 'REVOKED' : consent?.status === 'GRANTED'

    if (!permitted) {
      await unsafeDb.scheduledNotification.update({
        where: { id: scheduled.id },
        data: { status: 'FAILED', cancelledAt: new Date() },
      })
      return
    }

    const suppressed = await unsafeDb.suppressionEntry.findUnique({
      where: { channel_address: { channel, address } },
    })
    if (suppressed) return

    const trigger = scheduled.trigger ?? scheduled.schedule?.trigger ?? null
    const fallback = (trigger && DEFAULT_COPY[trigger]) ?? {
      subject: 'Your appointment',
      body: 'A reminder about your appointment.',
    }

    const template = scheduled.schedule?.template
    /*
     * The one-tap link, recomputed rather than looked up.
     *
     * `PostVisitCheckIn` stores only the hash of its token, so there is nothing
     * in the row to rebuild a URL from — the token is an HMAC of the appointment
     * id, which means a retried send produces the same link as the first
     * attempt without the secret ever living in the database.
     */
    const { checkInUrlFor } = await import('@/server/services/check-in')
    const body = renderTemplate(template?.body ?? fallback.body, {
      'client.firstName': scheduled.clientProfile.firstName,
      checkInUrl:
        trigger === 'APPOINTMENT_AFTER' && scheduled.refType === 'Appointment' && scheduled.refId
          ? checkInUrlFor(scheduled.refId)
          : '',
    })

    if (channel === 'SMS') {
      await smsPort().send({ to: address, body, reference: scheduled.id })
    } else {
      await emailPort().send({
        to: address,
        subject: template?.subject ?? fallback.subject,
        html: `<p>${body}</p>`,
        reference: scheduled.id,
      })
    }

    await unsafeDb.scheduledNotification.update({
      where: { id: scheduled.id },
      data: { status: 'SENT' },
    })
  },
})

/** Offer a freed slot to whoever on the waitlist actually fits it. */
const waitlistMatch = define({
  schema: z.object({ appointmentId: z.string() }),
  timeoutMs: 60_000,
  maxAttempts: 3,
  handler: async ({ appointmentId }) => {
    const { freedWindow, matchWaitlist } = await import('@/server/services/scheduling/waitlist')

    const appointment = await unsafeDb.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        salonId: true,
        startsAt: true,
        endsAt: true,
        location: { select: { timezone: true } },
        salon: { select: { defaultTimezone: true } },
      },
    })
    if (!appointment) return

    /*
     * This used to compare the cancelled appointment's raw duration against
     * `requiredDurationMin` and offer its exact start time — a different
     * question from "does this client's chain fit here". A two-hour
     * cancellation does not mean a two-hour service fits in it, because the
     * chain has buffers the duration does not and the stylist may be needed
     * inside it. It also ignored every preference the client expressed.
     */
    const timeZone = appointment.location.timezone || appointment.salon.defaultTimezone
    await matchWaitlist({
      salonId: appointment.salonId,
      ...freedWindow(appointment, timeZone),
    })
  },
})

/**
 * Reopen offers nobody answered.
 *
 * Without this an unanswered offer sits OFFERED forever: the client never gets
 * another one, the entry never comes back into the pool, and the slot stays
 * held. A waitlist that quietly stops matching is worse than not having one,
 * because the salon believes it is working.
 */
const waitlistExpire = define({
  schema: z.object({}).passthrough(),
  timeoutMs: 60_000,
  maxAttempts: 3,
  handler: async () => {
    const { sweepExpiredOffers } = await import('@/server/services/scheduling/waitlist')
    await sweepExpiredOffers()
  },
})

/** Nudge a client who started a consultation and drifted away. */
const consultationStaleNudge = define({
  schema: z.object({}).passthrough(),
  timeoutMs: 60_000,
  maxAttempts: 3,
  handler: async () => {
    const cutoff = new Date(Date.now() - 24 * 3_600_000)
    const stale = await unsafeDb.consultation.findMany({
      where: { status: 'DRAFT', updatedAt: { lt: cutoff } },
      select: { id: true, salonId: true, clientProfileId: true },
      take: 100,
    })

    /*
     * This used to enqueue a send directly for a dedupe key nothing ever
     * created a row against, so `notificationSend` looked it up, found
     * nothing, and returned — a job that has been quietly doing nothing since
     * it was written. Materialising first is the missing half.
     */
    for (const consultation of stale) {
      await materialiseNotification({
        salonId: consultation.salonId,
        trigger: 'CONSULT_STALE',
        refType: 'Consultation',
        refId: consultation.id,
        clientProfileId: consultation.clientProfileId,
      })
    }
  },
})

/**
 * Delete the raw files finished imports were built from.
 *
 * A salon's export holds more contact PII in one object than the platform
 * stores anywhere else — the whole client list, in the clear — and once the
 * rows are parsed the file has no further job. Retention runs from the batch
 * reaching a terminal state rather than from upload, so an import somebody is
 * still reviewing is never deleted out from under them.
 */
const importSourceReap = define({
  schema: z.object({}).passthrough(),
  timeoutMs: 120_000,
  maxAttempts: 3,
  handler: async () => {
    const { batchesDueForFileDeletion, markSourceDeleted } = await import(
      '@/server/services/migration/batch'
    )
    const cutoff = new Date(Date.now() - IMPORT_FILE_RETENTION_MS)

    const salons = await unsafeDb.importBatch.findMany({
      where: { sourceAssetKey: { not: null }, completedAt: { lt: cutoff } },
      select: { salonId: true },
      distinct: ['salonId'],
      take: 50,
    })

    for (const { salonId } of salons) {
      for (const batch of await batchesDueForFileDeletion(salonId, cutoff)) {
        /*
         * The row is marked first. A delete that fails leaves an object nobody
         * can reach through the app, which is recoverable; a marked-but-present
         * file that the sweep never revisits is a client list sitting in a
         * bucket forever, which is not.
         */
        await markSourceDeleted(salonId, batch.id)
        await storagePort().delete(batch.sourceAssetKey)
      }
    }
  },
})

/**
 * Tell clients whose colour is about due.
 *
 * A sweep rather than a per-appointment timer, because "due" moves: a client
 * who books in on their own stops being due, and a schedule minted at checkout
 * would have to be chased and cancelled. Materialising from the current state
 * each night means the question is always asked of the truth.
 */
const rebookNudge = define({
  schema: z.object({}).passthrough(),
  timeoutMs: 120_000,
  maxAttempts: 3,
  handler: async () => {
    const { nudgeRebookDue } = await import('@/server/services/retention')

    /*
     * Only salons that have configured the nudge. REBOOK_DUE is deliberately
     * outside ALWAYS_SEND — a rebooking message is marketing, and sending one
     * nobody set up is putting words in the salon's mouth — so a sweep over
     * every salon would do nothing for most of them at real cost.
     */
    const schedules = await unsafeDb.notificationSchedule.findMany({
      where: { trigger: 'REBOOK_DUE', isEnabled: true },
      select: { salonId: true },
      distinct: ['salonId'],
      take: 100,
    })

    for (const { salonId } of schedules) {
      if (salonId) await nudgeRebookDue(salonId)
    }
  },
})

/** Expire consultations and plans nobody acted on. */
const expireStale = define({
  schema: z.object({}).passthrough(),
  timeoutMs: 60_000,
  maxAttempts: 3,
  handler: async () => {
    const now = new Date()
    await unsafeDb.consultation.updateMany({
      where: { status: { in: ['DRAFT', 'SUBMITTED'] }, expiresAt: { lt: now } },
      data: { status: 'EXPIRED' },
    })
    await unsafeDb.servicePlan.updateMany({
      where: { status: { in: ['DRAFT', 'APPROVED'] }, validUntil: { lt: now } },
      data: { status: 'EXPIRED' },
    })
  },
})

/**
 * Re-authorise deposits whose hold is about to lapse.
 *
 * A card authorisation is not permanent — providers drop them after about a
 * week — and a deposit taken six weeks before an appointment will outlive its
 * own hold several times over. Left alone, the salon discovers on the day that
 * the money it was relying on was released a month ago.
 *
 * Re-authorising rather than capturing keeps the promise a promise: the client
 * agreed to a hold, not to being charged early.
 */
const depositReauthorize = define({
  schema: z.object({}).passthrough(),
  timeoutMs: 120_000,
  maxAttempts: 3,
  handler: async () => {
    const { renewDepositAuthorization, releaseDeposit } = await import(
      '@/server/services/deposits'
    )

    // A day's grace, so a hold is renewed before it lapses rather than after.
    const soon = new Date(Date.now() + 86_400_000)
    const expiring = await unsafeDb.deposit.findMany({
      where: { status: 'AUTHORIZED', authorizationExpiresAt: { lt: soon } },
      select: {
        id: true,
        salonId: true,
        appointmentId: true,
        appointment: { select: { startsAt: true, status: true } },
        salon: { select: { currency: true } },
      },
      take: 200,
    })

    for (const deposit of expiring) {
      /*
       * The appointment already happened, or was cancelled without the
       * cancellation path ever running. Renewing a hold against it would keep
       * a client's money reserved for an appointment that no longer exists.
       */
      const appointment = deposit.appointment
      const over =
        appointment != null &&
        (appointment.startsAt < new Date() ||
          appointment.status === 'CANCELLED' ||
          appointment.status === 'COMPLETED')

      try {
        if (over) {
          await releaseDeposit({ salonId: deposit.salonId, depositId: deposit.id })
          continue
        }
        await renewDepositAuthorization({
          salonId: deposit.salonId,
          depositId: deposit.id,
          currency: deposit.salon.currency,
        })
      } catch (error) {
        /*
         * One card declining must not stop the sweep. The salon is told rather
         * than the job silently dying, because a deposit that could not be
         * renewed is a conversation to have before the appointment, not after.
         */
        await unsafeDb.outbox.create({
          data: {
            salonId: deposit.salonId,
            topic: 'deposit.reauthorization_failed',
            payloadJson: { depositId: deposit.id, error: String(error) },
          },
        })
      }
    }
  },
})

/**
 * Score an uploaded photo.
 *
 * Off the request path deliberately: a client should never wait behind image
 * analysis to see their next question, and the estimate is usable without a
 * score. The result feeds the rules engine's DATA_QUALITY flag, which is what
 * turns "this photo is too small to judge tone" into a specific ask rather
 * than a vague apology at the end.
 */
const photoAssess = define({
  schema: z.object({ consultationPhotoId: z.string() }),
  timeoutMs: 30_000,
  maxAttempts: 3,
  handler: async ({ consultationPhotoId }) => {
    const photo = await unsafeDb.consultationPhoto.findUnique({
      where: { id: consultationPhotoId },
      include: { photoAsset: { select: { storageKey: true } } },
    })
    if (!photo) return

    const bytes = await storagePort().get(photo.photoAsset.storageKey)
    if (!bytes) return

    const quality = assessPhoto(bytes)

    await unsafeDb.consultationPhoto.update({
      where: { id: photo.id },
      data: { qualityScore: quality.score, qualityIssues: [...quality.issues] },
    })

    if (quality.dimensions) {
      await unsafeDb.photoAsset.update({
        where: { id: photo.photoAssetId },
        data: { width: quality.dimensions.width, height: quality.dimensions.height },
      })
    }
  },
})

/**
 * Capture estimated-versus-actual once an appointment is done.
 *
 * Uses CHAIR time rather than booked time. Booked time expands to fill the slot,
 * which would make the calibration loop self-fulfilling and useless.
 */
const quoteAccuracyCapture = define({
  schema: z.object({ appointmentId: z.string() }),
  timeoutMs: 30_000,
  maxAttempts: 3,
  handler: async ({ appointmentId }) => {
    const appointment = await unsafeDb.appointment.findUnique({
      where: { id: appointmentId },
      include: { services: true },
    })
    if (!appointment || appointment.status !== 'COMPLETED') return
    if (!appointment.chairStartedAt || !appointment.chairEndedAt) return

    const actualMin = Math.round(
      (appointment.chairEndedAt.getTime() - appointment.chairStartedAt.getTime()) / 60_000,
    )

    await unsafeDb.quoteAccuracy.upsert({
      where: { appointmentId },
      create: {
        salonId: appointment.salonId,
        appointmentId,
        servicePlanId: appointment.servicePlanId,
        stylistProfileId: appointment.primaryStylistId,
        serviceIds: appointment.services.map((s) => s.serviceId),
        estimatedDurationMin: appointment.estimatedDurationMin,
        actualDurationMin: actualMin,
        estimatedPriceCents: appointment.estimatedTotalCents,
        actualPriceCents: appointment.actualTotalCents ?? appointment.estimatedTotalCents,
        overranByMin: actualMin - appointment.estimatedDurationMin,
      },
      update: { actualDurationMin: actualMin },
    })
  },
})

/** Recompute each stylist's duration factor from their own history. */
const calibrationRecompute = define({
  schema: z.object({}).passthrough(),
  timeoutMs: 120_000,
  maxAttempts: 3,
  handler: async () => {
    const { computeCalibration } = await import('@/domain/analytics/calibration')
    const since = new Date(Date.now() - 180 * 86_400_000)

    const rows = await unsafeDb.quoteAccuracy.findMany({
      where: { computedAt: { gte: since } },
      select: {
        salonId: true,
        stylistProfileId: true,
        estimatedDurationMin: true,
        actualDurationMin: true,
      },
    })

    const grouped = new Map<string, { salonId: string; stylistId: string; ratios: number[] }>()
    for (const row of rows) {
      if (row.estimatedDurationMin <= 0) continue
      const key = row.stylistProfileId
      const bucket = grouped.get(key) ?? {
        salonId: row.salonId,
        stylistId: row.stylistProfileId,
        ratios: [],
      }
      bucket.ratios.push(row.actualDurationMin / row.estimatedDurationMin)
      grouped.set(key, bucket)
    }

    for (const { salonId, stylistId, ratios } of grouped.values()) {
      const result = computeCalibration(ratios)

      // Prisma cannot address a compound unique whose column is NULL, and the
      // service-agnostic row is exactly that — so find it explicitly.
      const existing = await unsafeDb.stylistCalibration.findFirst({
        where: { stylistProfileId: stylistId, serviceId: null },
        select: { id: true },
      })

      const values = {
        sampleCount: result.sampleCount,
        medianRatio: result.median,
        p90Ratio: result.p90,
        shrunkFactor: result.factor,
        computedAt: new Date(),
      }

      if (existing) {
        await unsafeDb.stylistCalibration.update({ where: { id: existing.id }, data: values })
      } else {
        await unsafeDb.stylistCalibration.create({
          data: {
            salonId,
            stylistProfileId: stylistId,
            windowStart: since,
            windowEnd: new Date(),
            ...values,
          },
        })
      }
    }
  },
})

/** Recover jobs stranded by a crashed worker. */
const systemReap = define({
  schema: z.object({}).passthrough(),
  timeoutMs: 30_000,
  maxAttempts: 3,
  handler: async () => {
    const { reap } = await import('./queue')
    await reap()

    /*
     * The attempt log, which nothing has ever deleted from.
     *
     * `withPublicAction` writes a row on every unauthenticated call — successes,
     * double-taps and link prefetchers alike — and the longest window any caller
     * counts over is measured in minutes. A day of history is generous for a
     * rate limiter and the difference between a table that stays small and one
     * that becomes the largest in the database the moment a retention feature
     * starts sending links.
     */
    await unsafeDb.publicActionAttempt.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) } },
    })
  },
})

// ---------------------------------------------------------------------------

export const JOB_REGISTRY: Record<string, AnyJobDefinition> = {
  'outbox.dispatch': outboxDispatch,
  'hold.expire': holdExpire,
  'notification.materialize': notificationMaterialize,
  'notification.send': notificationSend,
  'waitlist.match': waitlistMatch,
  'consultation.stale.nudge': consultationStaleNudge,
  'expire.stale': expireStale,
  'waitlist.expire': waitlistExpire,
  'deposit.reauthorize': depositReauthorize,
  'photo.assess': photoAssess,
  'quoteaccuracy.capture': quoteAccuracyCapture,
  'calibration.recompute': calibrationRecompute,
  'system.reap': systemReap,
  'import.source.reap': importSourceReap,
  'retention.rebook.nudge': rebookNudge,
}

export type JobType = keyof typeof JOB_REGISTRY

/** Sweeps the worker enqueues on a timer when nothing else triggers them. */
export const RECURRING: { key: string; type: string; everyMinutes: number }[] = [
  { key: 'outbox', type: 'outbox.dispatch', everyMinutes: 1 },
  { key: 'holds', type: 'hold.expire', everyMinutes: 1 },
  { key: 'waitlist', type: 'waitlist.expire', everyMinutes: 5 },
  { key: 'reap', type: 'system.reap', everyMinutes: 5 },
  { key: 'stale', type: 'expire.stale', everyMinutes: 60 },
  { key: 'deposits', type: 'deposit.reauthorize', everyMinutes: 360 },
  { key: 'nudge', type: 'consultation.stale.nudge', everyMinutes: 720 },
  { key: 'calibration', type: 'calibration.recompute', everyMinutes: 1440 },
  { key: 'import-files', type: 'import.source.reap', everyMinutes: 1440 },
  { key: 'rebook', type: 'retention.rebook.nudge', everyMinutes: 1440 },
]

function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => vars[key] ?? '')
}
