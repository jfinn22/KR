import { z } from 'zod'
import { unsafeDb } from '@/server/db/client'
import { emailPort, smsPort, storagePort } from '@/ports/registry'
import { assessPhoto } from '@/domain/hair/photo-quality'
import { installOutboxSink } from '@/server/outbox-sink'
import { enqueue } from './queue'

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

    const consent = await unsafeDb.contactConsent.findUnique({
      where: {
        clientProfileId_channel_purpose: {
          clientProfileId: scheduled.clientProfileId,
          channel,
          purpose: 'TRANSACTIONAL',
        },
      },
    })
    if (consent && consent.status === 'REVOKED') {
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

    const template = scheduled.schedule?.template
    const body = renderTemplate(template?.body ?? 'A reminder about your appointment.', {
      'client.firstName': scheduled.clientProfile.firstName,
    })

    if (channel === 'SMS') {
      await smsPort().send({ to: address, body, reference: scheduled.id })
    } else {
      await emailPort().send({
        to: address,
        subject: template?.subject ?? 'Your appointment',
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
    const appointment = await unsafeDb.appointment.findUnique({
      where: { id: appointmentId },
      select: { salonId: true, startsAt: true, endsAt: true, estimatedDurationMin: true },
    })
    if (!appointment) return

    const freedMinutes = appointment.estimatedDurationMin

    const entries = await unsafeDb.waitlistEntry.findMany({
      where: {
        salonId: appointment.salonId,
        status: 'OPEN',
        earliestDate: { lte: appointment.startsAt },
        latestDate: { gte: appointment.startsAt },
        // Only offer a slot the client's service actually fits into.
        requiredDurationMin: { lte: freedMinutes },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 5,
    })

    for (const entry of entries) {
      await unsafeDb.waitlistEntry.update({
        where: { id: entry.id },
        data: {
          status: 'OFFERED',
          offeredSlotJson: {
            startsAt: appointment.startsAt.toISOString(),
            endsAt: appointment.endsAt.toISOString(),
          },
          offerExpiresAt: new Date(Date.now() + 2 * 3_600_000),
          notifiedAt: new Date(),
        },
      })
      // First come, first served: one offer at a time avoids promising the
      // same slot to five people.
      break
    }
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

    for (const consultation of stale) {
      await enqueue({
        type: 'notification.send',
        salonId: consultation.salonId,
        payload: { dedupeKey: `consult-nudge:${consultation.id}` },
        dedupeKey: `consult-nudge:${consultation.id}`,
      })
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
  'photo.assess': photoAssess,
  'quoteaccuracy.capture': quoteAccuracyCapture,
  'calibration.recompute': calibrationRecompute,
  'system.reap': systemReap,
}

export type JobType = keyof typeof JOB_REGISTRY

/** Sweeps the worker enqueues on a timer when nothing else triggers them. */
export const RECURRING: { key: string; type: string; everyMinutes: number }[] = [
  { key: 'outbox', type: 'outbox.dispatch', everyMinutes: 1 },
  { key: 'holds', type: 'hold.expire', everyMinutes: 1 },
  { key: 'reap', type: 'system.reap', everyMinutes: 5 },
  { key: 'stale', type: 'expire.stale', everyMinutes: 60 },
  { key: 'nudge', type: 'consultation.stale.nudge', everyMinutes: 720 },
  { key: 'calibration', type: 'calibration.recompute', everyMinutes: 1440 },
]

function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => vars[key] ?? '')
}
