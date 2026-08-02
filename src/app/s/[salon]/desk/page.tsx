import Link from 'next/link'
import { pageContextFor } from '@/server/auth/page'
import { deskDay, type DeskAppointment } from '@/server/services/front-desk'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { Stat } from '@/components/ui/data'
import { cn } from '@/lib/utils'
import { addDays, formatDayHeading, formatMoney, formatTime, localDateIn } from '@/lib/format'
import { LifecycleButtons } from './lifecycle-buttons'

export const dynamic = 'force-dynamic'

/**
 * The front desk's day.
 *
 * Grouped by what needs doing rather than by time, because a chronological list
 * makes the desk scan the whole day to find the one client standing in front of
 * them. Running late is its own group and comes first: it is the thing this
 * screen exists to catch, and no status field records it.
 */
export default async function DeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ salon: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const [{ salon }, query] = await Promise.all([params, searchParams])
  const ctx = await pageContextFor(salon, 'appointment.viewAny')

  const localDate = query.date ?? localDateIn(ctx.timezone)
  const day = await deskDay(ctx.salonId, { localDate, timeZone: ctx.timezone })

  const isToday = localDate === localDateIn(ctx.timezone)

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-display-lg text-ink">
              {isToday ? 'Today' : formatDayHeading(localDate, ctx.timezone)}
            </h1>
            <p className="mt-1 text-body text-ink-muted">
              {formatDayHeading(localDate, ctx.timezone)}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/s/${salon}/desk?date=${addDays(localDate, -1)}`}>← Previous</Link>
            </Button>
            {!isToday && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/s/${salon}/desk`}>Today</Link>
              </Button>
            )}
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/s/${salon}/desk?date=${addDays(localDate, 1)}`}>Next →</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href={`/s/${salon}/desk/clients`}>Find a client</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Booked in" value={day.stats.booked} />
          <Stat label="Arrived" value={day.stats.arrived} hint={`of ${day.stats.booked}`} />
          <Stat
            label="Expected takings"
            value={formatMoney(day.stats.expectedCents, ctx.currency)}
          />
          <Stat
            label="Deposits outstanding"
            value={day.stats.unpaidDeposits}
            hint={day.stats.unpaidDeposits > 0 ? 'Take these on arrival' : 'All settled'}
          />
        </div>
      </header>

      {day.stats.booked === 0 ? (
        <EmptyState
          title="Nothing in the diary"
          description="No appointments booked for this day."
        />
      ) : (
        <div className="flex flex-col gap-10">
          <Group
            title="Running late"
            description="Should have started. Nobody has told them anything yet."
            rows={day.overdue}
            salon={salon}
            timeZone={ctx.timezone}
            currency={ctx.currency}
            urgent
          />
          <Group
            title="Arriving"
            rows={day.arriving}
            salon={salon}
            timeZone={ctx.timezone}
            currency={ctx.currency}
          />
          <Group
            title="In the chair"
            rows={day.inChair}
            salon={salon}
            timeZone={ctx.timezone}
            currency={ctx.currency}
          />
          <Group
            title="Processing"
            description="Colour is on. These stylists are free right now."
            rows={day.processing}
            salon={salon}
            timeZone={ctx.timezone}
            currency={ctx.currency}
          />
          <Group
            title="Finished"
            rows={day.finished}
            salon={salon}
            timeZone={ctx.timezone}
            currency={ctx.currency}
          />
        </div>
      )}
    </div>
  )
}

function Group({
  title,
  description,
  rows,
  salon,
  timeZone,
  currency,
  urgent,
}: {
  title: string
  description?: string
  rows: DeskAppointment[]
  salon: string
  timeZone: string
  currency: string
  urgent?: boolean
}) {
  if (rows.length === 0) return null

  return (
    <section>
      <div className="flex items-baseline gap-3">
        <h2 className={cn('font-display text-display-md', urgent ? 'text-danger' : 'text-ink')}>
          {title}
        </h2>
        <span className="tabular text-secondary text-ink-subtle">{rows.length}</span>
      </div>
      {description && <p className="mt-1 text-secondary text-ink-muted">{description}</p>}

      <ul className="mt-4 flex flex-col divide-y divide-line border-y border-line">
        {rows.map((row) => (
          <li
            key={row.id}
            className={cn(
              'flex flex-wrap items-center justify-between gap-4 border-l-4 py-4 pl-4',
              urgent ? 'border-l-danger' : 'border-l-transparent',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular text-body font-medium text-ink">
                  {formatTime(row.startsAt.toISOString(), timeZone)}
                </span>
                <span className="text-body text-ink">{row.clientName}</span>
                {row.clientIsNew && <Badge tone="info">New</Badge>}
                {row.hasOpenFlags && <Badge tone="warn">Open flag</Badge>}
                {row.depositCents > 0 && !row.depositPaid && (
                  <Badge tone="danger">Deposit due</Badge>
                )}
                {row.runningLateMin !== null && row.runningLateMin >= 10 && (
                  <Badge tone="danger">{row.runningLateMin}m late</Badge>
                )}
              </div>

              <p className="mt-1 text-secondary text-ink-muted">
                {row.serviceNames.join(' + ')} with {row.stylistName}
                {' · '}
                {formatMoney(row.estimatedTotalCents, currency)}
              </p>
            </div>

            <LifecycleButtons
              salonSlug={salon}
              appointmentId={row.id}
              status={row.status}
              needsPayment={row.needsPayment}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
