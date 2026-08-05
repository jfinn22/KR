'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { bookWholePlanAction, offerWholePlanAction } from '@/server/actions/booking'
import { formatDayHeading, formatTime, localDateIn } from '@/lib/format'

/**
 * Booking every visit at once.
 *
 * A correction plan is only honest if the client can actually get all three
 * appointments. Booking visit one and hoping visit two exists in eight weeks
 * is how a salon ends up with a half-finished blonde — and the gap between
 * visits is a chemical constraint the engine already computed, not a
 * preference to be sorted out later.
 *
 * The sequence is offered before it is booked. "Book all three" that then
 * fails is worse than never offering it: the client has already decided they
 * want the whole thing, and being told no at that point reads as the salon
 * changing its mind.
 */

interface OfferedSession {
  sequence: number
  name: string
  startsAt: string
  endsAt: string
  stylistName: string
}

export function BookWholePlan({
  salonSlug,
  timeZone,
  servicePlanId,
  fromDate,
  remaining,
}: {
  salonSlug: string
  timeZone: string
  servicePlanId: string
  fromDate: string
  /** How many visits are still unbooked. Below two this is not worth offering. */
  remaining: number
}) {
  const router = useRouter()
  const [offer, setOffer] = React.useState<{
    complete: boolean
    sessions: OfferedSession[]
    reason: string | null
  } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (remaining < 2) return null

  async function look() {
    setBusy(true)
    setError(null)
    try {
      const result = await offerWholePlanAction(salonSlug, { servicePlanId, fromDate })
      if (!result.ok) throw new Error(result.error)
      setOffer(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not work that out.')
    } finally {
      setBusy(false)
    }
  }

  async function take() {
    setBusy(true)
    setError(null)
    try {
      const result = await bookWholePlanAction(salonSlug, { servicePlanId, fromDate })
      if (!result.ok) throw new Error(result.error)
      router.push(`/s/${salonSlug}/my/appointments`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not book those.')
      setBusy(false)
      setOffer(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!offer && (
        <Button variant="secondary" onClick={look} disabled={busy}>
          {busy ? 'Working it out…' : `Can I book all ${remaining} visits now?`}
        </Button>
      )}

      {offer && !offer.complete && (
        <div className="rounded-lg border border-line bg-warn-soft p-5">
          <p className="text-body text-ink">
            {offer.reason ??
              'The whole sequence will not fit yet — the gaps between visits are too tight against what is free.'}
          </p>
          <p className="mt-2 text-secondary text-ink-muted">
            Book the next visit on its own and we will find the rest nearer the time.
          </p>
        </div>
      )}

      {offer?.complete && offer.sessions.length > 0 && (
        <div className="wash-gold flex flex-col gap-4 rounded-lg p-5">
          <div>
            <p className="label-caps mb-2">All {offer.sessions.length} visits, in one go</p>
            <ul className="flex flex-col gap-2">
              {offer.sessions.map((session) => (
                <li key={session.sequence} className="text-body text-ink">
                  <span className="font-medium">{session.name}</span>
                  <span className="tabular block text-secondary text-ink-muted">
                    {formatDayHeading(localDateIn(timeZone, new Date(session.startsAt)), timeZone)}
                    {' · '}
                    {formatTime(session.startsAt, timeZone)}–{formatTime(session.endsAt, timeZone)}
                    {' with '}
                    {session.stylistName}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="gold" onClick={take} disabled={busy}>
              {busy ? 'Booking…' : 'Book all of them'}
            </Button>
            <Button variant="ghost" onClick={() => setOffer(null)} disabled={busy}>
              I will pick them myself
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
