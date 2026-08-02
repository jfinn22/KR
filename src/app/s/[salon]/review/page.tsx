import Link from 'next/link'
import { pageContextFor } from '@/server/auth/page'
import {
  queueStats,
  reviewQueue,
  type QueueFilter,
  type QueueItem,
} from '@/server/services/review-queue'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { Stat } from '@/components/ui/data'
import { cn } from '@/lib/utils'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * The review queue.
 *
 * Ordered by urgency rather than arrival, because a queue that is merely
 * chronological buries the blocker behind six routine gloss consultations. The
 * severity and the clock are on every row, so a stylist with ten minutes can
 * pick the right ten minutes' work without opening anything.
 */

const FILTERS: { key: QueueFilter; label: string }[] = [
  { key: 'WAITING', label: 'Waiting' },
  { key: 'MINE', label: 'Mine' },
  { key: 'OVERDUE', label: 'Overdue' },
]

const SEVERITY_TONE = {
  BLOCKER: 'danger',
  HIGH: 'warn',
  CAUTION: 'gold',
  INFO: 'info',
  NONE: 'neutral',
} as const

export default async function ReviewQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ salon: string }>
  searchParams: Promise<{ filter?: string }>
}) {
  const [{ salon }, query] = await Promise.all([params, searchParams])
  const ctx = await pageContextFor(salon, 'consultation.review')

  const filter = (FILTERS.find((f) => f.key === query.filter)?.key ?? 'WAITING') as QueueFilter

  const [items, stats] = await Promise.all([
    reviewQueue(ctx.salonId, {
      filter,
      stylistProfileId: ctx.principal.kind === 'staff' ? ctx.principal.stylistProfileId : null,
    }),
    queueStats(ctx.salonId),
  ])

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-display-lg text-ink">Consultations to review</h1>
          <p className="mt-2 max-w-prose text-body text-ink-muted">
            The engine has already worked out what it thinks. Your job is to agree, correct it, or
            ask for what is missing.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Waiting" value={stats.waiting} />
          <Stat
            label="Past their SLA"
            value={stats.overdue}
            hint={stats.overdue > 0 ? 'Deal with these first' : 'All within promise'}
          />
          <Stat
            label="Open blockers"
            value={stats.blocked}
            hint={stats.blocked > 0 ? 'Clients who cannot book' : 'Nobody is stuck'}
          />
        </div>

        <nav className="flex gap-1 border-b border-line">
          {FILTERS.map((entry) => (
            <Link
              key={entry.key}
              href={`/s/${salon}/review?filter=${entry.key}`}
              className={cn(
                '-mb-px border-b-2 px-4 py-2.5 text-secondary transition-colors',
                filter === entry.key
                  ? 'border-b-gold-500 text-ink'
                  : 'border-b-transparent text-ink-muted hover:text-ink',
              )}
            >
              {entry.label}
            </Link>
          ))}
        </nav>
      </header>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="Every consultation has been dealt with. That is the goal."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {items.map((item) => (
            <QueueRow key={item.id} item={item} salon={salon} currency={ctx.currency} />
          ))}
        </ul>
      )}
    </div>
  )
}

function QueueRow({ item, salon, currency }: { item: QueueItem; salon: string; currency: string }) {
  const tone = SEVERITY_TONE[item.maxSeverity as keyof typeof SEVERITY_TONE] ?? 'neutral'

  return (
    <li>
      <Link
        href={`/s/${salon}/review/${item.id}`}
        className={cn(
          'flex flex-wrap items-center justify-between gap-4 border-l-4 py-4 pl-4 transition-colors hover:bg-surface-alt',
          item.overdue
            ? 'border-l-danger'
            : item.blocksOnlineBooking
              ? 'border-l-warn'
              : 'border-l-transparent',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body font-medium text-ink">{item.clientName}</span>
            {item.clientIsNew && <Badge tone="info">New client</Badge>}
            {item.flagCount > 0 && (
              <Badge tone={tone}>
                {item.flagCount} flag{item.flagCount === 1 ? '' : 's'}
              </Badge>
            )}
            {item.blocksOnlineBooking && <Badge tone="danger">Blocked online</Badge>}
            {item.sessionCount > 1 && <Badge tone="gold">{item.sessionCount} visits</Badge>}
          </div>

          <p className="mt-1 text-secondary text-ink-muted">
            {item.serviceNames.join(' + ')}
            {item.requestedStylistName ? ` · asked for ${item.requestedStylistName}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-6">
          <span className="tabular text-secondary text-ink">
            {formatMoney(item.estimatedTotalCents, currency)}
          </span>
          <span
            className={cn(
              'tabular w-24 text-right text-secondary',
              item.overdue ? 'text-danger' : 'text-ink-subtle',
            )}
          >
            {formatDue(item.hoursLeft)}
          </span>
        </div>
      </Link>
    </li>
  )
}

/** The clock the salon promised the client, not the time since submission. */
function formatDue(hoursLeft: number | null): string {
  if (hoursLeft === null) return '—'
  if (hoursLeft < 0) {
    const over = Math.abs(hoursLeft)
    return over >= 24 ? `${Math.floor(over / 24)}d over` : `${Math.ceil(over)}h over`
  }
  if (hoursLeft < 1) return `${Math.max(1, Math.round(hoursLeft * 60))}m left`
  if (hoursLeft < 24) return `${Math.floor(hoursLeft)}h left`
  return `${Math.floor(hoursLeft / 24)}d left`
}
