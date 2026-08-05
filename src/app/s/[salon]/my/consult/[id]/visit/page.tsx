import Link from 'next/link'
import { notFound } from 'next/navigation'
import { pageContext } from '@/server/auth/page'
import {
  consultInvite,
  findConsultSlots,
} from '@/server/services/scheduling/consult-appointment'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { addDays, formatDayHeading, formatTime, localDateIn } from '@/lib/format'
import { VisitBooking } from './visit-booking'

export const dynamic = 'force-dynamic'

/** How far ahead the first search looks. Widened on request. */
const INITIAL_WINDOW_DAYS = 21

/**
 * "Come in and let me look at it."
 *
 * The one screen that turns a review decision into something a client can do.
 * `REQUEST_IN_PERSON` set a status and stopped, so a stylist saying "I need to
 * see this" produced a consultation that quietly went nowhere — and a client
 * who was told nothing.
 */
export default async function VisitPage({
  params,
}: {
  params: Promise<{ salon: string; id: string }>
}) {
  const { salon, id } = await params
  const ctx = await pageContext(salon)

  const invite = await consultInvite(ctx.salonId, id)
  if (!invite) notFound()

  if (invite.alreadyBooked) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <EmptyState
          title="You are booked in"
          description={`${formatDayHeading(
            localDateIn(ctx.timezone, invite.alreadyBooked.startsAt),
            ctx.timezone,
          )} at ${formatTime(invite.alreadyBooked.startsAt.toISOString(), ctx.timezone)}.`}
          action={
            <Button asChild>
              <Link href={`/s/${salon}/my/appointments`}>See your appointments</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const from = localDateIn(ctx.timezone)
  const to = addDays(from, INITIAL_WINDOW_DAYS)
  const initial = await findConsultSlots({
    salonId: ctx.salonId,
    consultationId: id,
    fromDate: from,
    toDate: to,
  })

  return (
    <VisitBooking
      salonSlug={salon}
      timeZone={ctx.timezone}
      consultationId={id}
      stylistName={invite.stylistName}
      reason={invite.reason}
      minutes={invite.minutes}
      initialFrom={from}
      initialTo={to}
      initialSlots={initial.slots}
      initialReason={initial.reason}
    />
  )
}
