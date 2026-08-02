import * as React from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'

/**
 * A client's hair history as one vertical thread.
 *
 * The thing a paper card never gave a salon: every chemical event, in order,
 * with what it was and how it turned out. A stylist covering for a colleague
 * can read three years of somebody's hair in ten seconds, and a client can see
 * why the answer to "can I go platinum this Saturday" is what it is.
 */

export type TimelineKind =
  | 'APPOINTMENT'
  | 'COLOUR'
  | 'LIGHTENING'
  | 'TREATMENT'
  | 'CONSULTATION'
  | 'PATCH_TEST'
  | 'NOTE'
  | 'HOME_CARE'

export interface TimelineEntry {
  id: string
  kind: TimelineKind
  occurredAt: string
  title: string
  detail?: string | null
  stylistName?: string | null
  /** Formula, level, developer — whatever was recorded. */
  facts?: readonly { label: string; value: string }[]
  outcome?: 'GOOD' | 'MIXED' | 'POOR' | null
}

const KIND_STYLE: Record<TimelineKind, { dot: string; label: string }> = {
  APPOINTMENT: { dot: 'bg-blue-500', label: 'Appointment' },
  COLOUR: { dot: 'bg-blue-900', label: 'Colour' },
  LIGHTENING: { dot: 'bg-gold-500', label: 'Lightening' },
  TREATMENT: { dot: 'bg-success', label: 'Treatment' },
  CONSULTATION: { dot: 'bg-blue-300', label: 'Consultation' },
  PATCH_TEST: { dot: 'bg-line-strong', label: 'Patch test' },
  HOME_CARE: { dot: 'bg-gold-300', label: 'At home' },
  NOTE: { dot: 'bg-line-strong', label: 'Note' },
}

const OUTCOME_TONE = {
  GOOD: { tone: 'success', label: 'Went well' },
  MIXED: { tone: 'warn', label: 'Mixed' },
  POOR: { tone: 'danger', label: 'Did not go to plan' },
} as const

export function HairTimeline({
  entries,
  emptyTitle = 'Nothing on record yet',
  emptyDescription = 'Once you have had an appointment, everything we do will show up here.',
  className,
}: {
  entries: readonly TimelineEntry[]
  emptyTitle?: string
  emptyDescription?: string
  className?: string
}) {
  if (entries.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} className={className} />
  }

  const ordered = [...entries].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))

  return (
    <ol className={cn('relative flex flex-col', className)}>
      {/* The thread. Sits behind the dots, stopping at the last entry. */}
      <span aria-hidden="true" className="absolute bottom-6 left-[7px] top-3 w-px bg-line" />

      {ordered.map((entry) => {
        const style = KIND_STYLE[entry.kind] ?? KIND_STYLE.NOTE
        const outcome = entry.outcome ? OUTCOME_TONE[entry.outcome] : null

        return (
          <li key={entry.id} className="relative flex gap-4 pb-8 last:pb-0">
            <span
              aria-hidden="true"
              className={cn(
                'relative z-10 mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-2 border-canvas',
                style.dot,
              )}
            />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <time
                  dateTime={entry.occurredAt}
                  className="tabular text-label uppercase tracking-[0.08em] text-ink-subtle"
                >
                  {formatDate(entry.occurredAt)}
                </time>
                <span className="label-caps">{style.label}</span>
                {outcome && <Badge tone={outcome.tone}>{outcome.label}</Badge>}
              </div>

              <p className="mt-1 text-body font-medium text-ink">{entry.title}</p>

              {entry.detail && (
                <p className="mt-1 max-w-prose text-secondary text-ink-muted">{entry.detail}</p>
              )}

              {entry.facts && entry.facts.length > 0 && (
                <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3">
                  {entry.facts.map((fact) => (
                    <div key={fact.label}>
                      <dt className="label-caps">{fact.label}</dt>
                      <dd className="tabular text-secondary text-ink">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {entry.stylistName && (
                <p className="mt-2 text-label text-ink-subtle">with {entry.stylistName}</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}
