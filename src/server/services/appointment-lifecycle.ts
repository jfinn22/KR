import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import { enqueue } from '@/server/jobs/queue'
import { assessCancellation } from '@/server/services/commerce'

/**
 * The day of the appointment.
 *
 * Four moments the salon actually records: the client arrives, the stylist
 * starts, the stylist finishes, the client leaves. Each one is a separate
 * timestamp rather than a single "done" flag, and the reason is calibration:
 * chair time is the only honest measure of how long a service takes.
 *
 * Booked time expands to fill whatever slot was allocated — if a stylist is
 * given three hours they will use three hours — so calibrating on booked time
 * is a loop that confirms its own estimate forever. `chairStartedAt` to
 * `chairEndedAt` is the number that tells the truth, which is why the day-of
 * flow is worth the extra taps.
 */

export type LifecycleStep = 'CHECK_IN' | 'START_CHAIR' | 'END_CHAIR' | 'CHECK_OUT' | 'NO_SHOW'

/** What may follow what. A state machine, not a set of independent buttons. */
const ALLOWED_FROM: Record<LifecycleStep, readonly string[]> = {
  CHECK_IN: ['BOOKED', 'CONFIRMED'],
  START_CHAIR: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'],
  END_CHAIR: ['IN_CHAIR', 'PROCESSING'],
  CHECK_OUT: ['IN_CHAIR', 'PROCESSING', 'COMPLETED'],
  NO_SHOW: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'],
}

const NEXT_STATUS: Record<LifecycleStep, string> = {
  CHECK_IN: 'CHECKED_IN',
  START_CHAIR: 'IN_CHAIR',
  END_CHAIR: 'COMPLETED',
  CHECK_OUT: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
}

export interface AdvanceInput {
  salonId: string
  appointmentId: string
  step: LifecycleStep
  actorUserId?: string | null
  at?: Date
}

export async function advanceAppointment(
  input: AdvanceInput,
): Promise<{ status: string; at: Date }> {
  const db = dbFor(input.salonId)
  const at = input.at ?? new Date()

  const result = await db.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirst({
      where: { id: input.appointmentId, salonId: input.salonId },
      select: {
        id: true,
        status: true,
        version: true,
        clientProfileId: true,
        chairStartedAt: true,
        servicePlanSessionId: true,
      },
    })
    if (!appointment) throw new DomainError('NOT_FOUND', 'That appointment no longer exists.')

    const allowed = ALLOWED_FROM[input.step]
    if (!allowed.includes(appointment.status)) {
      throw new DomainError('CONFLICT', explainRefusal(input.step, appointment.status))
    }

    const data: Record<string, unknown> = {
      status: NEXT_STATUS[input.step],
      version: { increment: 1 },
    }

    switch (input.step) {
      case 'CHECK_IN':
        data.checkedInAt = at
        break
      case 'START_CHAIR':
        data.chairStartedAt = at
        // Somebody sat down without being checked in — that is the arrival.
        data.checkedInAt = at
        break
      case 'END_CHAIR':
        data.chairEndedAt = at
        break
      case 'CHECK_OUT':
        data.checkedOutAt = at
        // Checking out without ending the chair is common at a busy desk.
        data.chairEndedAt = at
        break
      case 'NO_SHOW':
        data.noShowAt = at
        break
    }

    // Optimistic lock: the front desk and the stylist both touch this row, and
    // a lost update here corrupts the calibration data.
    const updated = await tx.appointment.updateMany({
      where: { id: appointment.id, version: appointment.version },
      data: data as never,
    })
    if (updated.count === 0) {
      throw new DomainError('CONFLICT', 'Someone else just updated this appointment.')
    }

    if (input.step === 'NO_SHOW') {
      await tx.clientProfile.update({
        where: { id: appointment.clientProfileId },
        data: { noShowCount: { increment: 1 } },
      })
      // Free the time so the waitlist can be offered it.
      await tx.appointmentSegment.deleteMany({ where: { appointmentId: appointment.id } })
    }

    const finished = input.step === 'END_CHAIR' || input.step === 'CHECK_OUT'

    /*
     * One visit, however many taps it took.
     *
     * The desk's normal sequence is two — "Finished", then "Check out" — and
     * both land here, so an unguarded increment counts every appointment twice
     * at a salon that uses both buttons and once at a salon that skips straight
     * to checkout. That makes the number wrong AND inconsistent between salons,
     * which is worse: `completedVisits === 0` is how nine places in this
     * platform ask "is this a new client", and every retention figure is built
     * on top of it. The quote-accuracy enqueue below has always been deduped
     * for exactly this reason; the counter never was.
     */
    const alreadyCounted = appointment.status === 'COMPLETED'

    if (finished && !alreadyCounted) {
      await tx.clientProfile.update({
        where: { id: appointment.clientProfileId },
        data: { completedVisits: { increment: 1 }, lastVisitAt: at },
      })
      // The first one, set once and never moved — it is what the whole
      // first-timer cohort is measured from.
      await tx.clientProfile.updateMany({
        where: { id: appointment.clientProfileId, firstVisitAt: null },
        data: { firstVisitAt: at },
      })
    } else if (finished) {
      await tx.clientProfile.update({
        where: { id: appointment.clientProfileId },
        data: { lastVisitAt: at },
      })
    }

    if (finished) {
      if (appointment.servicePlanSessionId) {
        await tx.servicePlanSession.update({
          where: { id: appointment.servicePlanSessionId },
          data: { status: 'COMPLETED' },
        })
      }

      // Estimated-versus-actual, off the request path. Deduped, because
      // ending the chair and then checking out both land here.
      await enqueue(
        {
          salonId: input.salonId,
          type: 'quoteaccuracy.capture',
          payload: { appointmentId: appointment.id },
          dedupeKey: `quote:${appointment.id}`,
        },
        tx,
      )

      /*
       * "How is it sitting?"
       *
       * Emitted on the first of the two taps that finish an appointment and not
       * the second — `alreadyCounted` is what keeps a two-tap checkout from
       * asking the same client twice how their hair is. How long afterwards it
       * goes out is the schedule's business; a salon with no APPOINTMENT_AFTER
       * schedule sends nothing at all.
       */
      if (!alreadyCounted) {
        await tx.outbox.create({
          data: {
            salonId: input.salonId,
            topic: 'appointment.completed',
            payloadJson: {
              appointmentId: appointment.id,
              clientProfileId: appointment.clientProfileId,
            },
          },
        })
      }
    }

    await tx.outbox.create({
      data: {
        salonId: input.salonId,
        topic: `appointment.${input.step.toLowerCase()}`,
        payloadJson: { appointmentId: appointment.id, at: at.toISOString() },
      },
    })

    return { status: NEXT_STATUS[input.step], at }
  })

  /*
   * The desk marking a no-show is the second route to one — `cancelAppointment`
   * with `markNoShow` is the first — and it has to settle the deposit too, or
   * which button the desk happened to press decides whether the client is
   * charged. Outside the transaction, because it talks to the provider.
   *
   * Not fatal, for the same reason as in `cancelAppointment`: the appointment
   * IS a no-show, and a slow card network must not make the desk think the
   * button failed and press it again.
   */
  if (input.step === 'NO_SHOW') {
    try {
      await assessCancellation({
        salonId: input.salonId,
        appointmentId: input.appointmentId,
        cancelledAt: at,
        isNoShow: true,
      })
    } catch (error) {
      await db.outbox.create({
        data: {
          salonId: input.salonId,
          topic: 'cancellation.assessment_failed',
          payloadJson: { appointmentId: input.appointmentId, error: String(error) },
        },
      })
    }
  }

  return result
}

/** Say what is actually wrong, not "invalid transition". */
function explainRefusal(step: LifecycleStep, status: string): string {
  if (status === 'CANCELLED') return 'This appointment was cancelled.'
  if (status === 'NO_SHOW') return 'This appointment is marked as a no-show.'

  switch (step) {
    case 'CHECK_IN':
      return status === 'CHECKED_IN'
        ? 'They are already checked in.'
        : 'This appointment has already started.'
    case 'START_CHAIR':
      return 'This appointment has already started or finished.'
    case 'END_CHAIR':
      return 'Start the appointment before finishing it.'
    case 'CHECK_OUT':
      return 'This appointment has not started yet.'
    case 'NO_SHOW':
      return 'They have already arrived.'
  }
}

/**
 * Note that a client is now processing.
 *
 * Distinct from IN_CHAIR because it is what tells the front desk the stylist is
 * momentarily free — the same fact the scheduler uses to interleave, surfaced
 * to a human who can act on it right now.
 */
export async function markProcessing(input: {
  salonId: string
  appointmentId: string
  untilMinutes: number
}): Promise<void> {
  const db = dbFor(input.salonId)
  const appointment = await db.appointment.findFirst({
    where: { id: input.appointmentId, salonId: input.salonId },
    select: { id: true, status: true },
  })
  if (!appointment) throw new DomainError('NOT_FOUND', 'That appointment no longer exists.')
  if (appointment.status !== 'IN_CHAIR') {
    throw new DomainError('CONFLICT', 'The client needs to be in the chair first.')
  }

  await db.appointment.update({
    where: { id: appointment.id },
    data: { status: 'PROCESSING', version: { increment: 1 } },
  })
}
