'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SlotPicker, SlotSummary, type OfferedSlot } from '@/components/salon/slot-picker'
import {
  confirmBookingAction,
  findSlotsAction,
  holdSlotAction,
  releaseHoldAction,
} from '@/server/actions/booking'

/**
 * Search, hold, confirm.
 *
 * The hold is what makes the confirmation screen safe: a client reading the
 * summary is not racing whoever loaded the same slot list a second earlier.
 * It expires on its own, so an abandoned checkout returns the time to the
 * salon with nobody intervening — and the countdown is visible, because a
 * silent expiry that fails at the final tap is worse than a clock.
 */

const WIDEN_DAYS = 21

export interface SlotSearchResult {
  slots: readonly OfferedSlot[]
  reason: string | null
  bookable: boolean
  earliestDate: string | null
  /** The narrowing the stylist applied at approval, in words. Null if none. */
  restrictedTo: string | null
}

export function BookingFlow({
  salonSlug,
  timeZone,
  servicePlanId,
  sequence,
  sessionName,
  totalSessions,
  stylistName,
  initialFrom,
  initialTo,
  initialResult,
}: {
  salonSlug: string
  timeZone: string
  currency: string
  servicePlanId: string
  sequence: number
  sessionName: string
  totalSessions: number
  stylistName: string | null
  initialFrom: string
  initialTo: string
  initialResult: SlotSearchResult
}) {
  const router = useRouter()

  const [result, setResult] = React.useState(initialResult)
  const [to, setTo] = React.useState(initialTo)
  const [selected, setSelected] = React.useState<OfferedSlot | null>(null)
  const [hold, setHold] = React.useState<{ holdId: string; expiresAt: string } | null>(null)
  const [anyStylist, setAnyStylist] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const search = React.useCallback(
    async (toDate: string, useAnyStylist: boolean) => {
      setBusy(true)
      setError(null)

      const response = await findSlotsAction(salonSlug, {
        servicePlanId,
        sequence,
        fromDate: initialFrom,
        toDate,
        anyStylist: useAnyStylist,
      })

      if (!response.ok) setError(response.error)
      else setResult(response.data)

      setBusy(false)
    },
    [salonSlug, servicePlanId, sequence, initialFrom],
  )

  async function choose(slot: OfferedSlot) {
    setBusy(true)
    setError(null)

    // Release the previous hold first — a client trying three times should not
    // leave three slots locked behind them.
    if (hold) await releaseHoldAction(salonSlug, { holdId: hold.holdId })

    const response = await holdSlotAction(salonSlug, {
      servicePlanId,
      sequence,
      fromDate: initialFrom,
      toDate: to,
      anyStylist,
      token: slot.token,
    })

    if (!response.ok) {
      setError(response.error)
      setSelected(null)
      setHold(null)
      // Whatever happened, the board has moved. Show what is actually free.
      await search(to, anyStylist)
      return
    }

    setSelected(slot)
    setHold(response.data)
    setBusy(false)
  }

  async function confirm() {
    if (!hold) return
    setBusy(true)
    setError(null)

    const response = await confirmBookingAction(salonSlug, {
      holdId: hold.holdId,
      servicePlanId,
      sequence,
    })

    if (!response.ok) {
      setError(response.error)
      setBusy(false)
      setHold(null)
      setSelected(null)
      await search(to, anyStylist)
      return
    }
    router.push(`/s/${salonSlug}/my/appointments?booked=${response.data.appointmentId}`)
  }

  async function widen() {
    const next = addDays(to, WIDEN_DAYS)
    setTo(next)
    await search(next, anyStylist)
  }

  async function toggleAnyStylist() {
    const next = !anyStylist
    setAnyStylist(next)
    await search(to, next)
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header>
        {/*
         * There was no way off this screen except booking or the browser's
         * back button. `back()` rather than a fixed link because the slot
         * picker is reached both from the plan and from the client home.
         */}
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3.5 mb-2"
          onClick={() => router.back()}
          disabled={busy}
        >
          ← Back
        </Button>

        {totalSessions > 1 && (
          <Badge tone="gold" className="mb-3">
            Visit {sequence} of {totalSessions}
          </Badge>
        )}
        <h1 className="font-display text-display-lg text-ink">{sessionName}</h1>
        {stylistName && !anyStylist && (
          <p className="mt-2 text-body text-ink-muted">Times shown are {stylistName}&rsquo;s.</p>
        )}
        {/*
         * Said up front rather than only when the list comes back empty. A
         * client who does not know a restriction exists reads a short list as
         * the salon being busy, widens the range, and gets the same short list
         * back — over and over against something no amount of widening moves.
         */}
        {result.restrictedTo && (
          <p className="mt-2 text-body text-gold-700">
            {stylistName ? `${stylistName} has` : 'Your stylist has'} asked to do this on{' '}
            {result.restrictedTo}.
          </p>
        )}
      </header>

      {!result.bookable ? (
        <div className="rounded-lg border border-line bg-warn-soft p-5">
          <p className="text-body text-ink">
            {result.reason ?? 'This visit cannot be booked yet.'}
          </p>
        </div>
      ) : selected && hold ? (
        <div className="flex flex-col gap-6">
          <SlotSummary slot={selected} timeZone={timeZone} />
          <HoldTimer expiresAt={hold.expiresAt} />

          {error && (
            <p role="alert" className="text-secondary text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button onClick={confirm} disabled={busy}>
              {busy ? 'Booking…' : 'Confirm this time'}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                await releaseHoldAction(salonSlug, { holdId: hold.holdId })
                setSelected(null)
                setHold(null)
                await search(to, anyStylist)
              }}
            >
              Pick a different time
            </Button>
          </div>
        </div>
      ) : (
        <>
          {stylistName && (
            <div>
              <Button variant="secondary" size="sm" onClick={toggleAnyStylist} disabled={busy}>
                {anyStylist ? `Only show ${stylistName}` : 'Show anyone who can do this'}
              </Button>
            </div>
          )}

          {error && (
            <p role="alert" className="text-secondary text-danger">
              {error}
            </p>
          )}

          <SlotPicker
            slots={result.slots}
            timeZone={timeZone}
            onSelect={choose}
            onWiden={widen}
            reason={result.reason}
            busy={busy}
            showStylist={anyStylist}
          />
        </>
      )}
    </div>
  )
}

/**
 * The countdown on a held slot.
 *
 * Visible rather than silent: a hold that quietly expires and fails at the
 * final tap feels like the salon losing the booking, and that is the moment a
 * client gives up and phones somewhere else.
 */
function HoldTimer({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = React.useState(() => secondsUntil(expiresAt))

  React.useEffect(() => {
    const id = setInterval(() => setRemaining(secondsUntil(expiresAt)), 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  if (remaining <= 0) {
    return (
      <p role="alert" className="text-secondary text-warn">
        We could not keep that time held. Pick another and we will try again.
      </p>
    )
  }

  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60

  return (
    <p aria-live="polite" className="text-secondary text-ink-muted">
      Held for you for{' '}
      <span className="tabular font-medium text-ink">
        {minutes}:{String(seconds).padStart(2, '0')}
      </span>
    </p>
  )
}

function secondsUntil(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000))
}

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
