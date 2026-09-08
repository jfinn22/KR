'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { SlotPicker, SlotSummary, type OfferedSlot } from '@/components/salon/slot-picker'
import { bookConsultAppointmentAction, findConsultSlotsAction } from '@/server/actions/booking'
import { formatMinutes } from '@/lib/format'

/**
 * Picking a time to come in.
 *
 * The client chooses, not the stylist. A stylist picking a slot for somebody
 * whose availability they do not know is how a salon gets a no-show it then
 * blames on the client — and this appointment exists precisely because the
 * relationship needs care.
 *
 * No hold and no countdown, unlike the plan booking flow. Thirty minutes with
 * one named stylist is not a slot five other people are racing for, and a
 * ticking clock on "your stylist wants to see you" reads as pressure at the
 * exact moment the client is already worried about their hair.
 */

const WIDEN_DAYS = 21

export function VisitBooking({
  salonSlug,
  timeZone,
  consultationId,
  stylistName,
  reason,
  minutes,
  initialFrom,
  initialTo,
  initialSlots,
  initialReason,
}: {
  salonSlug: string
  timeZone: string
  consultationId: string
  stylistName: string | null
  reason: string | null
  minutes: number
  initialFrom: string
  initialTo: string
  initialSlots: readonly OfferedSlot[]
  initialReason: string | null
}) {
  const router = useRouter()

  const [slots, setSlots] = React.useState(initialSlots)
  const [searchReason, setSearchReason] = React.useState(initialReason)
  const [to, setTo] = React.useState(initialTo)
  const [selected, setSelected] = React.useState<OfferedSlot | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function search(through: string) {
    setBusy(true)
    setError(null)
    try {
      const result = await findConsultSlotsAction(salonSlug, {
        consultationId,
        fromDate: initialFrom,
        toDate: through,
      })
      if (!result.ok) throw new Error(result.error)
      setSlots(result.data.slots)
      setSearchReason(result.data.reason)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not find any times.')
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const result = await bookConsultAppointmentAction(salonSlug, {
        consultationId,
        token: selected.token,
      })
      if (!result.ok) throw new Error(result.error)
      router.push(`/s/${salonSlug}/my/appointments?booked=${result.data.appointmentId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not book that.')
      setBusy(false)
      setSelected(null)
      await search(to)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3.5 mb-2"
          onClick={() => router.back()}
          disabled={busy}
        >
          ← Back
        </Button>

        <h1 className="font-display text-display-lg text-ink">
          {stylistName ? `${stylistName} would like a look` : 'Come in for a look'}
        </h1>
        <p className="mt-2 text-body text-ink-muted">
          {formatMinutes(minutes)}, no charge — just so we can see the hair before we quote.
        </p>

        {/*
         * The stylist's own words, if they left any. A client asked to come in
         * with no reason given assumes the worst, and the decision panel has
         * been collecting "what the client sees" all along.
         */}
        {reason && (
          <div className="wash-gold mt-5 rounded-lg p-5">
            <p className="label-caps mb-1">Why</p>
            <p className="text-body text-ink">{reason}</p>
          </div>
        )}
      </header>

      {selected ? (
        <div className="flex flex-col gap-6">
          <SlotSummary slot={selected} timeZone={timeZone} />

          {error && (
            <p role="alert" className="text-secondary text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button onClick={confirm} disabled={busy}>
              {busy ? 'Booking…' : 'Confirm this time'}
            </Button>
            <Button variant="secondary" onClick={() => setSelected(null)} disabled={busy}>
              Pick a different time
            </Button>
          </div>
        </div>
      ) : (
        <>
          <SlotPicker
            slots={slots}
            timeZone={timeZone}
            reason={searchReason}
            busy={busy}
            onSelect={setSelected}
            onWiden={async () => {
              const next = addDaysLocal(to, WIDEN_DAYS)
              setTo(next)
              await search(next)
            }}
          />

          {error && (
            <p role="alert" className="text-secondary text-danger">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function addDaysLocal(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
