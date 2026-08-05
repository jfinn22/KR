import type { MessageChannel, NotificationTrigger } from '@prisma/client'
import { unsafeDb } from '@/server/db/client'
import { enqueue } from '@/server/jobs/queue'

/**
 * Turning "something happened" into "somebody was told".
 *
 * There was exactly one materialiser and it was welded to appointments: it
 * hardcoded `trigger: 'APPOINTMENT_BEFORE'`, loaded an Appointment, and
 * anchored on `startsAt`. Everything else that should reach a client — a
 * consultation being approved, a freed slot being offered, a deposit falling
 * due — had nowhere to go.
 *
 * The proof it was structural rather than an oversight: `consultationStaleNudge`
 * already enqueued a send with dedupe key `consult-nudge:<id>`, and nothing
 * ever created a `ScheduledNotification` with that key. `notificationSend`
 * looks the row up and silently returns when it is missing, so that job has
 * been a no-op in production since it was written.
 *
 * This is the generic version: any trigger, anchored on anything, for any
 * reference. A salon that has configured schedules for the trigger gets one
 * notification per schedule; a salon that has not still gets the message,
 * because a consultation decision the client never hears about is worse than
 * one worded from a default.
 */

export interface MaterialiseInput {
  salonId: string
  trigger: NotificationTrigger
  /** What this is about — `Consultation`, `Appointment`, `WaitlistEntry`… */
  refType: string
  refId: string
  clientProfileId: string
  /**
   * What the schedule offsets are measured from. Defaults to now, which is
   * right for anything that has just happened; an appointment reminder passes
   * the appointment's start instead.
   */
  anchorAt?: Date
  /** Used only when the salon has configured no schedule for this trigger. */
  fallbackChannel?: MessageChannel
}

/**
 * Triggers that should still reach the client with no schedule configured.
 *
 * The distinction is whether the message is part of the service or part of the
 * salon's own marketing cadence. Being told your consultation was approved is
 * the former: a salon that has not set up a template has not thereby decided
 * their clients should hear nothing. A rebooking nudge is the latter, and
 * sending one nobody configured would be putting words in the salon's mouth.
 */
const ALWAYS_SEND: ReadonlySet<NotificationTrigger> = new Set([
  'CONSULT_DECISION',
  'WAITLIST_OFFER',
  'DEPOSIT_DUE',
  /*
   * The post-visit check-in, which nothing in the product can configure.
   *
   * `NotificationSchedule` has exactly one writer in the whole repo — the seed —
   * and there is no screen that creates one. Left out of this set, the check-in
   * materialises zero rows for every real salon, which is the same dead-on-
   * arrival shape this trigger has had since the schema was written. It is part
   * of the service rather than the salon's marketing cadence: the client had the
   * appointment, and asking whether it worked is not selling to them.
   */
  'APPOINTMENT_AFTER',
] as NotificationTrigger[])

/**
 * How long after the anchor an always-send trigger goes out with no schedule.
 *
 * Most of them are immediate — an approval or a waitlist offer is stale the
 * moment it waits. The check-in is the opposite: sent at the till it is asking
 * somebody how their hair is while they are still standing in front of the
 * mirror, and the whole value of the question is that it is asked once the
 * colour has been washed a couple of times.
 */
const DEFAULT_OFFSET_MINUTES: Partial<Record<NotificationTrigger, number>> = {
  APPOINTMENT_AFTER: 72 * 60,
}

export interface MaterialiseResult {
  scheduled: number
}

export async function materialiseNotification(input: MaterialiseInput): Promise<MaterialiseResult> {
  const anchor = input.anchorAt ?? new Date()

  const schedules = await unsafeDb.notificationSchedule.findMany({
    where: { salonId: input.salonId, isEnabled: true, trigger: input.trigger },
  })

  if (schedules.length === 0) {
    if (!ALWAYS_SEND.has(input.trigger)) return { scheduled: 0 }

    await scheduleOne({
      salonId: input.salonId,
      scheduleId: null,
      trigger: input.trigger,
      clientProfileId: input.clientProfileId,
      refType: input.refType,
      refId: input.refId,
      channel: input.fallbackChannel ?? 'EMAIL',
      sendAt: new Date(anchor.getTime() + (DEFAULT_OFFSET_MINUTES[input.trigger] ?? 0) * 60_000),
      dedupeKey: `notify:${input.trigger}:${input.refId}`,
    })
    return { scheduled: 1 }
  }

  let scheduled = 0
  for (const schedule of schedules) {
    const sendAt = new Date(anchor.getTime() + schedule.offsetMinutes * 60_000)

    /*
     * A send time already in the past is dropped for a FUTURE anchor — a
     * reminder for an appointment starting in ten minutes should not fire a
     * "24 hours to go" message. But when the anchor is the event itself, an
     * offset of zero is exactly right and must not be dropped.
     */
    if (sendAt <= new Date() && anchor > new Date()) continue

    await scheduleOne({
      salonId: input.salonId,
      scheduleId: schedule.id,
      trigger: input.trigger,
      clientProfileId: input.clientProfileId,
      refType: input.refType,
      refId: input.refId,
      channel: schedule.channel,
      sendAt: sendAt < new Date() ? new Date() : sendAt,
      dedupeKey: `notify:${input.refId}:${schedule.key}`,
    })
    scheduled++
  }

  return { scheduled }
}

async function scheduleOne(row: {
  salonId: string
  scheduleId: string | null
  trigger: NotificationTrigger
  clientProfileId: string
  refType: string
  refId: string
  channel: MessageChannel
  sendAt: Date
  dedupeKey: string
}): Promise<void> {
  await unsafeDb.scheduledNotification.upsert({
    where: { dedupeKey: row.dedupeKey },
    create: {
      salonId: row.salonId,
      scheduleId: row.scheduleId,
      trigger: row.trigger,
      clientProfileId: row.clientProfileId,
      refType: row.refType,
      refId: row.refId,
      channel: row.channel,
      sendAt: row.sendAt,
      dedupeKey: row.dedupeKey,
    },
    update: { sendAt: row.sendAt, cancelledAt: null },
  })

  await enqueue({
    type: 'notification.send',
    salonId: row.salonId,
    payload: { dedupeKey: row.dedupeKey },
    runAt: row.sendAt,
    dedupeKey: `send:${row.dedupeKey}`,
  })
}

/**
 * Default wording, by trigger.
 *
 * Only reached when a salon has not written a template. Deliberately plain and
 * factual — a default that tried to sound like the salon would be putting
 * words in their mouth, and the one thing worse than a generic message is a
 * chatty one somebody else wrote.
 */
export const DEFAULT_COPY: Record<string, { subject: string; body: string }> = {
  CONSULT_DECISION: {
    subject: 'Your consultation has been looked at',
    body: 'Hi {{client.firstName}}, your stylist has been through your consultation. Open your account to see what they said and book a time.',
  },
  WAITLIST_OFFER: {
    subject: 'A time has come free',
    body: 'Hi {{client.firstName}}, a slot you were waiting for has just opened up. It is held for a short while — open your account to take it.',
  },
  DEPOSIT_DUE: {
    subject: 'Your deposit',
    body: 'Hi {{client.firstName}}, there is a deposit outstanding on your booking. Open your account to settle it.',
  },
  APPOINTMENT_AFTER: {
    subject: 'How is it sitting?',
    body: 'Hi {{client.firstName}}, how are you getting on with it? One tap tells us, and if anything is not quite right it is far easier to put right now: {{checkInUrl}}',
  },
  REBOOK_DUE: {
    subject: 'Time for your next visit',
    body: 'Hi {{client.firstName}}, you are about due. Open your account to find a time.',
  },
  PLAN_EXPIRING: {
    subject: 'Your plan is about to expire',
    body: 'Hi {{client.firstName}}, the plan your stylist agreed is close to running out. Book in to keep it.',
  },
  PATCH_TEST_DUE: {
    subject: 'Your patch test',
    body: 'Hi {{client.firstName}}, you need a patch test before your next colour. It takes a minute and has to be at least 48 hours before.',
  },
}
