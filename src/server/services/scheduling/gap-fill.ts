import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import { EVERY_DAY, type BookingWindow } from '@/domain/scheduling/window'
import {
  localDateOfEpochMinutes,
  localTimeToEpochMinutes,
  toEpochMinutes,
} from '@/domain/scheduling/zoned'

/**
 * Selling the gap in the middle of somebody else's appointment.
 *
 * A colour has twenty to forty minutes where the stylist is doing nothing but
 * waiting, and the data model has known that since it was written: a phase
 * with `requiresStylist = false` becomes a segment with `blocksStylist =
 * false`, which keeps the stylist out of their own busy set. The diary has
 * been drawing those gaps in gold and calling them free for months. Nothing
 * could be booked into one.
 *
 * This is the door. It is deliberately thin, because the solver already does
 * all of the hard parts — concurrency caps, the minimum interleave, whether
 * the salon has interleaving switched on at all — and re-deciding any of that
 * here would be a second opinion that could disagree with the one that
 * actually places the appointment.
 *
 * It is keyed on the SEGMENT rather than on a start and end time in the URL.
 * A window a browser can type is a window a browser can widen, and "book me
 * into this gap" turning into "book me anywhere" is not a mistake worth
 * leaving available.
 */

export interface GapToFill {
  segmentId: string
  stylistId: string
  stylistName: string
  localDate: string
  /** Narrowed so the new appointment must START inside the gap. */
  window: BookingWindow
  startMin: number
  endMin: number
  /** Who the gap belongs to, so the desk can see whose column it is in. */
  occupiedBy: string
}

export async function loadGap(salonId: string, segmentId: string): Promise<GapToFill> {
  const db = dbFor(salonId)
  const segment = await db.appointmentSegment.findFirst({
    where: { id: segmentId, salonId },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      blocksStylist: true,
      state: true,
      stylistProfileId: true,
      stylistProfile: { select: { displayName: true } },
      location: { select: { timezone: true } },
      appointment: {
        select: { clientProfile: { select: { firstName: true, lastName: true } } },
      },
    },
  })
  if (!segment) throw new DomainError('NOT_FOUND', 'That block is no longer in the diary.')

  /*
   * Only a gap is fillable. A segment where the stylist is working is somebody
   * having their hair done, and booking a second client into it would put two
   * people in one chair.
   */
  if (segment.blocksStylist) {
    throw new DomainError('CONFLICT', 'The stylist is working through that block.')
  }
  if (segment.state !== 'ACTIVE') {
    throw new DomainError('CONFLICT', 'That block is only a hold, not a booking.')
  }

  const timeZone = segment.location.timezone
  const startMin = toEpochMinutes(segment.startsAt)
  const endMin = toEpochMinutes(segment.endsAt)
  const localDate = localDateOfEpochMinutes(startMin, timeZone)

  const client = segment.appointment?.clientProfile
  const occupiedBy = client ? `${client.firstName} ${client.lastName ?? ''}`.trim() : 'a client'

  /*
   * A gap with no stylist is not a gap anybody can be booked into — there is
   * nobody to do the hair. The column exists as nullable because a resource
   * can be blocked without a stylist attached.
   */
  if (!segment.stylistProfileId) {
    throw new DomainError('CONFLICT', 'That block has no stylist against it.')
  }

  return {
    segmentId: segment.id,
    stylistId: segment.stylistProfileId,
    stylistName: segment.stylistProfile?.displayName ?? 'the stylist',
    localDate,
    window: gapWindow(startMin, endMin, timeZone),
    startMin,
    endMin,
    occupiedBy,
  }
}

/**
 * The gap expressed as a booking window.
 *
 * Only the START is constrained, and that is not an oversight. Whether the new
 * appointment FITS is a question about the stylist's busy set — they become
 * busy again the moment their own client's next active phase begins — and the
 * solver already answers it. Constraining the end here as well would be a
 * second, weaker copy of a rule the database is enforcing anyway, and the two
 * would eventually disagree.
 */
function gapWindow(startMin: number, endMin: number, timeZone: string): BookingWindow {
  const localDate = localDateOfEpochMinutes(startMin, timeZone)

  /*
   * A `BookingWindow` counts minutes from LOCAL midnight; everything else in
   * the scheduler counts epoch minutes. Converting through the same helper the
   * loader uses is what keeps the two agreeing — doing the arithmetic by hand
   * silently shifts every gap by the UTC offset, which is invisible in London
   * in winter and an hour out everywhere else.
   */
  const localMidnight = localTimeToEpochMinutes(localDate, 0, timeZone)

  return {
    earliestDate: localDate,
    latestDate: localDate,
    dayOfWeekMask: EVERY_DAY,
    windowStartMinute: startMin - localMidnight,
    // At least a minute wide, so a zero-length segment cannot produce a window
    // that excludes its own start and silently matches nothing.
    windowEndMinute: Math.max(startMin - localMidnight + 1, endMin - localMidnight),
  }
}
