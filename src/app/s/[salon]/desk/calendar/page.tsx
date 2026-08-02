import Link from 'next/link'
import { pageContextFor } from '@/server/auth/page'
import { daySchedule } from '@/server/services/front-desk'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { cn } from '@/lib/utils'
import { addDays, formatDayHeading, formatTime, localDateIn } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * The day, by stylist.
 *
 * Segments rather than appointments, because the gaps are the point: a
 * processing block is drawn in gold and labelled as free, which is the twenty
 * minutes a front desk can actually sell. A calendar that draws each
 * appointment as one solid bar hides the single biggest source of capacity a
 * salon already owns.
 */

/** The window drawn. Outside it there is nothing to see. */
const DAY_START_MIN = 7 * 60
const DAY_END_MIN = 21 * 60
const PIXELS_PER_MIN = 1.4

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ salon: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const [{ salon }, query] = await Promise.all([params, searchParams])
  const ctx = await pageContextFor(salon, 'appointment.viewAny')

  const localDate = query.date ?? localDateIn(ctx.timezone)
  const { columns } = await daySchedule(ctx.salonId, { localDate, timeZone: ctx.timezone })

  const height = (DAY_END_MIN - DAY_START_MIN) * PIXELS_PER_MIN
  const hours = Array.from(
    { length: (DAY_END_MIN - DAY_START_MIN) / 60 + 1 },
    (_, i) => DAY_START_MIN + i * 60,
  )

  const anything = columns.some((column) => column.segments.length > 0)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-display-lg text-ink">The day</h1>
          <p className="mt-1 text-body text-ink-muted">
            {formatDayHeading(localDate, ctx.timezone)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/s/${salon}/desk/calendar?date=${addDays(localDate, -1)}`}>←</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/s/${salon}/desk/calendar`}>Today</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/s/${salon}/desk/calendar?date=${addDays(localDate, 1)}`}>→</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href={`/s/${salon}/desk?date=${localDate}`}>List view</Link>
          </Button>
        </div>
      </header>

      <p className="text-secondary text-ink-muted">
        Gold blocks are processing — the stylist is free and somebody else could be in that chair.
      </p>

      {!anything ? (
        <EmptyState title="Nothing booked" description="No appointments on this day." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-canvas">
          <div className="flex min-w-max">
            {/* Time gutter */}
            <div className="w-16 shrink-0 border-r border-line" style={{ height }}>
              {hours.map((minute) => (
                <div
                  key={minute}
                  className="tabular absolute -translate-y-1/2 pl-2 text-label text-ink-subtle"
                  style={{
                    marginTop: (minute - DAY_START_MIN) * PIXELS_PER_MIN,
                    position: 'relative',
                  }}
                >
                  {String(Math.floor(minute / 60)).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {columns.map((column) => (
              <div
                key={column.stylist.id}
                className="w-56 shrink-0 border-r border-line last:border-r-0"
              >
                <div className="sticky top-0 border-b border-line bg-canvas px-3 py-2">
                  <p className="truncate text-secondary font-medium text-ink">
                    {column.stylist.displayName}
                  </p>
                </div>

                <div className="relative" style={{ height }}>
                  {/* Hour rules */}
                  {hours.map((minute) => (
                    <div
                      key={minute}
                      className="absolute inset-x-0 border-t border-line/60"
                      style={{ top: (minute - DAY_START_MIN) * PIXELS_PER_MIN }}
                    />
                  ))}

                  {column.segments.map((segment) => {
                    const start = minutesInto(segment.startsAt, ctx.timezone)
                    const end = minutesInto(segment.endsAt, ctx.timezone)
                    const top = (start - DAY_START_MIN) * PIXELS_PER_MIN
                    const blockHeight = Math.max(14, (end - start) * PIXELS_PER_MIN)

                    if (end < DAY_START_MIN || start > DAY_END_MIN) return null

                    return (
                      <div
                        key={segment.id}
                        title={`${segment.clientName} · ${segment.kind.toLowerCase()}`}
                        className={cn(
                          'absolute inset-x-1 overflow-hidden rounded-md border px-2 py-1',
                          segment.state === 'HOLD'
                            ? 'border-dashed border-line-strong bg-surface-alt'
                            : segment.blocksStylist
                              ? 'border-blue-500/30 bg-blue-100'
                              : 'border-gold-500/40 bg-gold-100',
                        )}
                        style={{ top, height: blockHeight }}
                      >
                        <p className="truncate text-label font-medium text-ink">
                          {segment.blocksStylist ? segment.clientName : 'Free — processing'}
                        </p>
                        {blockHeight > 34 && (
                          <p className="tabular truncate text-label text-ink-muted">
                            {formatTime(segment.startsAt.toISOString(), ctx.timezone)}
                            {segment.serviceNames.length > 0
                              ? ` · ${segment.serviceNames.join(', ')}`
                              : ''}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Minutes since local midnight, in the salon's zone. */
function minutesInto(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).formatToParts(at)

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}
