'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SlotPicker, SlotSummary, type OfferedSlot } from '@/components/salon/slot-picker'
import { CardOnFile, type SavedCardView } from '@/components/salon/card-on-file'
import { JoinWaitlist } from '@/components/salon/join-waitlist'
import { formatMoney } from '@/lib/format'
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
  currency,
  servicePlanId,
  sequence,
  sessionName,
  totalSessions,
  stylistName,
  initialFrom,
  initialTo,
  initialResult,
  clientProfileId,
  depositCents,
  cards,
  serviceIds,
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
  clientProfileId: string
  /** What this visit owes up front. Zero for every visit but the first. */
  depositCents: number
  cards: SavedCardView[]
  /** What this session is for, so the waitlist knows what to match against. */
  serviceIds: readonly string[]
}) {
  const router = useRouter()

  const [result, setResult] = React.useState(initialResult)
  const [to, setTo] = React.useState(initialTo)
  const [selected, setSelected] = React.useState<OfferedSlot | null>(null)
  const [hold, setHold] = React.useState<{ holdId: string; expiresAt: string } | null>(null)
  const [anyStylist, setAnyStylist] = React.useState(false)

  /*
   * `CardOnFile` refreshes the route once a card is attached, so `cards`
   * arrives new from the server rather than needing local state here.
   */
  const needsCard = depositCents > 0 && cards.length === 0
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

          {/*
           * The deposit is asked for HERE, on the confirmation screen, and not
           * a step earlier. A client who has not yet chosen a time has not
           * agreed to anything, and asking for a card before they have is the
           * fastest way to lose a booking that was going to happen.
           */}
          {depositCents > 0 && (
            <div className="bg-gold-soft rounded-lg border border-line p-5">
              <p className="text-body text-ink">
                This visit asks for a {formatMoney(depositCents, currency)} deposit, which comes off
                the cost on the day.
              </p>
              <div className="mt-4">
                <CardOnFile
                  salonSlug={salonSlug}
                  clientProfileId={clientProfileId}
                  cards={cards}
                  purpose={
                    cards.length > 0
                      ? 'We will hold the deposit against this card. Nothing is taken until the day.'
                      : 'Add a card to hold the deposit. Nothing is taken until the day.'
                  }
                />
              </div>
              {needsCard && (
                <p className="mt-3 text-secondary text-ink-muted">
                  Add a card above and the time you are holding stays yours while you do it.
                </p>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-secondary text-danger">
              {error}
            </p>
          )}

          {/*
           * A deposit needs a card, and the button used to say so and then not
           * mean it: with nothing on file, `authorizeDeposit` refuses, the
           * appointment is booked anyway, and the deposit sits PENDING forever
           * while the client — who pressed a button labelled "pay the deposit"
           * — believes they have paid it. Refused here, where it can be fixed,
           * rather than swallowed there.
           */}
          <div className="flex flex-wrap gap-3">
            <Button onClick={confirm} disabled={busy || needsCard}>
              {busy
                ? 'Booking…'
                : depositCents > 0
                  ? 'Confirm and pay the deposit'
                  : 'Confirm this time'}
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

          {/*
           * Offered exactly when the client has just been told there is
           * nothing — the only moment a waiting list is genuinely useful. On a
           * page with times available it is noise, and in a menu it is never
           * found.
           */}
          {result.slots.length === 0 && (
            <JoinWaitlist
              salonSlug={salonSlug}
              clientProfileId={clientProfileId}
              serviceIds={serviceIds}
              earliestDate={initialFrom}
              latestDate={to}
            />
          )}
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
