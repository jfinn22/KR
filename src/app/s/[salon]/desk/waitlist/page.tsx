import Link from 'next/link'
import { pageContextFor } from '@/server/auth/page'
import { salonWaitlist } from '@/server/services/scheduling/waitlist'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { formatMinutes, formatTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Who is waiting.
 *
 * The list has existed in the schema since it was written and there was no way
 * to see it — which meant the only person who knew somebody was waiting was
 * whoever put them there, and only if they remembered.
 *
 * Sorted the way it is worked: priority first, then longest wait. What each
 * person actually asked for is shown in words rather than as a bitmask,
 * because "Tuesdays and Thursdays, mornings" is a thing a front desk can act
 * on when a client rings up to move an appointment.
 */
export default async function WaitlistPage({ params }: { params: Promise<{ salon: string }> }) {
  const { salon } = await params
  const ctx = await pageContextFor(salon, 'waitlist.manage')

  const entries = await salonWaitlist(ctx.salonId)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header>
        <h1 className="heading-flourish font-display text-display-lg text-ink">Waiting list</h1>
        <p className="mt-2 text-body text-ink-muted">
          When something is cancelled, whoever it genuinely suits is offered it first — and the slot
          is held for them while they answer.
        </p>
      </header>

      {entries.length === 0 ? (
        <EmptyState
          title="Nobody is waiting"
          description="Add somebody from their client record when the day they wanted is full."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-5 sm:flex-row sm:items-start sm:justify-between"
            >
              <div>
                <Link
                  href={`/s/${salon}/desk/clients/${entry.clientId}`}
                  className="text-body font-medium text-ink hover:text-blue-700"
                >
                  {entry.clientName}
                </Link>
                <p className="mt-1 text-secondary text-ink-muted">
                  {entry.serviceNames.join(' + ')} · {formatMinutes(entry.requiredDurationMin)}
                </p>
                <p className="mt-1 text-secondary text-ink-muted">
                  {entry.describes ? `Wants ${entry.describes}` : 'Any time that comes free'}
                </p>
              </div>

              <div className="flex flex-col items-start gap-2 sm:items-end">
                {entry.status === 'OFFERED' ? (
                  <>
                    <Badge tone="gold">Offered</Badge>
                    {entry.offerExpiresAt && (
                      <span className="tabular text-secondary text-ink-muted">
                        until {formatTime(entry.offerExpiresAt.toISOString(), ctx.timezone)}
                      </span>
                    )}
                  </>
                ) : (
                  <Badge tone="info">Waiting {daysSince(entry.waitingSince)}</Badge>
                )}
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/s/${salon}/desk/book?client=${entry.clientId}`}>Book them in</Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function daysSince(at: Date): string {
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000)
  if (days <= 0) return 'since today'
  if (days === 1) return 'since yesterday'
  return `${days} days`
}
