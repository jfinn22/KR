'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  acceptWaitlistOfferAction,
  declineWaitlistOfferAction,
  leaveWaitlistAction,
} from '@/server/actions/booking'
import { formatDayHeading, formatTime, localDateIn } from '@/lib/format'

/**
 * What the client is waiting for, and what has come free.
 *
 * The offer is the whole point of this panel, so it is the loudest thing on
 * it. An offer that looks like the rest of the page gets missed, and an offer
 * that gets missed expires — at which point the salon has an empty chair and
 * the client thinks the waitlist does not work.
 *
 * Both buttons are real. "No thanks" puts them back on the list rather than
 * off it, because turning down one Tuesday is not the same as no longer
 * wanting an appointment, and a decline that quietly removed them would be the
 * kind of thing nobody notices until they ring up asking why.
 */

export interface WaitlistView {
  id: string
  status: string
  serviceNames: string[]
  describes: string | null
  offer: { startsAt: string; endsAt: string; stylistName: string } | null
  offerExpiresAt: Date | string | null
}

export function WaitlistPanel({
  salonSlug,
  timeZone,
  entries,
}: {
  salonSlug: string
  timeZone: string
  entries: WaitlistView[]
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function run(id: string, work: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(id)
    setError(null)
    try {
      const result = await work()
      if (!result.ok) throw new Error(result.error)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setBusy(null)
    }
  }

  if (entries.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={
            entry.offer
              ? 'wash-gold flex flex-col gap-4 rounded-lg p-5'
              : 'flex flex-col gap-3 rounded-lg border border-line bg-canvas p-5'
          }
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-body font-medium text-ink">{entry.serviceNames.join(' + ')}</p>
              <p className="mt-1 text-secondary text-ink-muted">
                {entry.describes ? `Any time ${entry.describes}` : 'Any time that comes free'}
              </p>
            </div>
            {!entry.offer && <Badge tone="info">Waiting</Badge>}
          </div>

          {entry.offer ? (
            <>
              <div>
                <p className="label-caps mb-1">Something has come free</p>
                <p className="font-display text-display-sm text-ink">
                  {formatDayHeading(localDateIn(timeZone, new Date(entry.offer.startsAt)), timeZone)}
                </p>
                <p className="tabular mt-1 text-body text-ink">
                  {formatTime(entry.offer.startsAt, timeZone)} –{' '}
                  {formatTime(entry.offer.endsAt, timeZone)} with {entry.offer.stylistName}
                </p>
                {entry.offerExpiresAt && (
                  <p className="mt-2 text-secondary text-ink-muted">
                    Held for you until {formatTime(new Date(entry.offerExpiresAt).toISOString(), timeZone)}.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="gold"
                  disabled={busy !== null}
                  onClick={() =>
                    run(entry.id, () => acceptWaitlistOfferAction(salonSlug, { entryId: entry.id }))
                  }
                >
                  {busy === entry.id ? 'Booking…' : 'Take it'}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() =>
                    run(entry.id, () => declineWaitlistOfferAction(salonSlug, { entryId: entry.id }))
                  }
                >
                  No thanks — stay on the list
                </Button>
              </div>
            </>
          ) : (
            <div>
              <Button
                variant="ghost"
                size="sm"
                className="-ml-3.5"
                disabled={busy !== null}
                onClick={() =>
                  run(entry.id, () => leaveWaitlistAction(salonSlug, { entryId: entry.id }))
                }
              >
                Take me off the list
              </Button>
            </div>
          )}
        </div>
      ))}

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
