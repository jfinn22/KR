import { pageContextFor } from '@/server/auth/page'
import { permitted } from '@/server/auth/context'
import { timeOffFor } from '@/server/services/time-off'
import { SectionHeading } from '@/components/ui/data'
import { EmptyState } from '@/components/ui/feedback'
import { TimeOffPanel } from './time-off-panel'

export const dynamic = 'force-dynamic'

/**
 * Who is away, and who has asked to be.
 *
 * `TimeOff` was read by the availability solver from the day the scheduler was
 * written and written by nothing, so the only way a salon could stop a stylist
 * being booked while they were on holiday was to delete their working hours and
 * remember to put them back. This is the screen that writes it.
 *
 * Requests carry the number of appointments already inside the window rather
 * than being refused for clashing. Somebody being ill on a Friday is exactly
 * when a manager needs to approve it anyway — what they need is the count of
 * people to ring, not a wall.
 */
export default async function TimeOffPage({ params }: { params: Promise<{ salon: string }> }) {
  const { salon } = await params
  const ctx = await pageContextFor(salon, 'schedule.editOwn')

  const mayDecide = permitted(ctx, 'schedule.editAny')
  const stylistProfileId = ctx.principal.kind === 'staff' ? ctx.principal.stylistProfileId : null

  /*
   * A stylist sees their own; anybody who can decide sees everybody's. Somebody
   * with neither a stylist profile nor the deciding permission has nothing to
   * look at, which is an honest empty state rather than an error.
   */
  const rows = await timeOffFor(
    ctx.salonId,
    mayDecide ? {} : { stylistProfileId: stylistProfileId ?? '' },
  )

  const stylists = mayDecide
    ? await ctx.db.stylistProfile.findMany({
        where: { salonId: ctx.salonId, isActive: true },
        select: { id: true, displayName: true },
        orderBy: { displayName: 'asc' },
      })
    : stylistProfileId
      ? await ctx.db.stylistProfile.findMany({
          where: { id: stylistProfileId, salonId: ctx.salonId },
          select: { id: true, displayName: true },
        })
      : []

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="heading-flourish font-display text-display-lg text-ink">Time off</h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          Only approved time takes a stylist out of the diary. Asking for it costs the salon nothing
          until somebody agrees.
        </p>
      </header>

      {stylists.length === 0 ? (
        <EmptyState
          title="Nothing to show you"
          description="You are not attached to a stylist, and you cannot decide other people's time off."
        />
      ) : (
        <>
          <section>
            <SectionHeading title="Ask for time off" />
            <div className="mt-6">
              <TimeOffPanel
                salonSlug={salon}
                stylists={stylists}
                defaultStylistId={stylistProfileId ?? stylists[0]?.id ?? ''}
                mayDecide={mayDecide}
                rows={rows.map((row) => ({
                  id: row.id,
                  stylistName: row.stylistName,
                  startsAt: row.startsAt.toISOString(),
                  endsAt: row.endsAt.toISOString(),
                  allDay: row.allDay,
                  reason: row.reason,
                  status: row.status,
                  clashes: row.clashes,
                }))}
                timeZone={ctx.timezone}
              />
            </div>
          </section>
        </>
      )}
    </div>
  )
}
