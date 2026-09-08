'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/field'
import { SlotPicker, SlotSummary, type OfferedSlot } from '@/components/salon/slot-picker'
import {
  bookFromDeskAction,
  deskBookingContextAction,
  findDeskSlotsAction,
} from '@/server/actions/booking'
import { formatMinutes, formatMoney } from '@/lib/format'

/**
 * The desk's booking flow.
 *
 * Three steps in the order the phone call actually happens: who is it for
 * (chosen on the page before this one), what do they want, and when.
 *
 * The gate is resolved between step two and step three, on purpose. A desk
 * that searches, offers "Thursday at two?", and only then learns the client
 * needs a patch test has already made a promise it has to take back — so the
 * refusal, or the "this needs signing off", lands before any time is spoken
 * out loud.
 */

const WIDEN_DAYS = 14

interface ServiceOption {
  id: string
  name: string
  priceCents: number
  requiresConsultation: boolean
  isChemical: boolean
}

interface Gate {
  decision: 'DIRECT' | 'PLAN' | 'OVERRIDABLE' | 'REFUSED'
  reason: string | null
}

export interface GapView {
  segmentId: string
  stylistName: string
  occupiedBy: string
  localDate: string
  minutes: number
}

export function DeskBooking({
  salonSlug,
  timeZone,
  currency,
  clientProfileId,
  clientName,
  today,
  categories,
  gap,
}: {
  salonSlug: string
  timeZone: string
  currency: string
  clientProfileId: string
  clientName: string
  today: string
  categories: { id: string; name: string; services: ServiceOption[] }[]
  /** Set when the desk arrived by clicking a gold block in the diary. */
  gap?: GapView | null
}) {
  const router = useRouter()

  const [picked, setPicked] = React.useState<string[]>([])
  const [context, setContext] = React.useState<{
    gate: Gate
    durationMin: number
    estimatedTotalCents: number
    mayOverride: boolean
  } | null>(null)
  const [slots, setSlots] = React.useState<readonly OfferedSlot[] | null>(null)
  const [reason, setReason] = React.useState<string | null>(null)
  const [toDate, setToDate] = React.useState(addDays(today, WIDEN_DAYS))
  const [selected, setSelected] = React.useState<OfferedSlot | null>(null)
  const [overrideReason, setOverrideReason] = React.useState('')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const allServices = categories.flatMap((c) => c.services)
  const chosen = picked
    .map((id) => allServices.find((s) => s.id === id))
    .filter((s): s is ServiceOption => s !== undefined)

  function toggle(serviceId: string) {
    // Any change to the basket invalidates the gate AND the times, because
    // both were answers to a different question.
    setContext(null)
    setSlots(null)
    setSelected(null)
    setPicked((current) =>
      current.includes(serviceId)
        ? current.filter((id) => id !== serviceId)
        : [...current, serviceId],
    )
  }

  async function check() {
    setBusy(true)
    setError(null)
    try {
      const result = await deskBookingContextAction(salonSlug, {
        clientProfileId,
        serviceIds: picked,
      })
      if (!result.ok) throw new Error(result.error)
      setContext(result.data as typeof context)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check that.')
    } finally {
      setBusy(false)
    }
  }

  const search = React.useCallback(
    async (through: string) => {
      setBusy(true)
      setError(null)
      try {
        const result = await findDeskSlotsAction(salonSlug, {
          clientProfileId,
          serviceIds: picked,
          fromDate: today,
          toDate: through,
          fillSegmentId: gap?.segmentId ?? null,
        })
        if (!result.ok) throw new Error(result.error)
        setSlots(result.data.slots)
        setReason(result.data.reason)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not find any times.')
      } finally {
        setBusy(false)
      }
    },
    [salonSlug, clientProfileId, picked, today, gap?.segmentId],
  )

  async function book() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const result = await bookFromDeskAction(salonSlug, {
        clientProfileId,
        serviceIds: picked,
        token: selected.token,
        stylistId: selected.stylistId,
        clientNote: note.trim() || null,
        overrideReason: overrideReason.trim() || null,
        fillSegmentId: gap?.segmentId ?? null,
      })
      if (!result.ok) throw new Error(result.error)
      router.push(`/s/${salonSlug}/desk/calendar?date=${selected.localDate}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not book that.')
      setBusy(false)
      // The time may have gone while the desk was typing. Show what is left.
      setSelected(null)
      await search(toDate)
    }
  }

  const gate = context?.gate
  const blocked = gate?.decision === 'REFUSED'
  const needsSignOff = gate?.decision === 'OVERRIDABLE'
  const canProceed =
    gate != null &&
    !blocked &&
    (!needsSignOff || (context!.mayOverride && overrideReason.length >= 4))

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-display text-display-lg text-ink">Book for {clientName}</h1>
        {gap && (
          <p className="mt-2 text-body text-gold-700">
            Into {gap.stylistName}&rsquo;s {formatMinutes(gap.minutes)} of processing time while{' '}
            {gap.occupiedBy} develops. Only services that fit will come back.
          </p>
        )}
      </header>

      <section>
        <h2 className="label-caps mb-3">What are they having?</h2>
        <div className="flex flex-col gap-5">
          {categories.map((category) => (
            <div key={category.id}>
              <p className="mb-2 text-secondary text-ink-muted">{category.name}</p>
              <div className="flex flex-wrap gap-2">
                {category.services.map((service) => {
                  const on = picked.includes(service.id)
                  return (
                    <button
                      key={service.id}
                      type="button"
                      onClick={() => toggle(service.id)}
                      aria-pressed={on}
                      className={`rounded-md border px-3 py-2 text-left text-secondary transition-colors ${
                        on
                          ? 'bg-gold-soft border-gold-500 text-ink'
                          : 'border-line text-ink hover:border-gold-500'
                      }`}
                    >
                      <span className="block">{service.name}</span>
                      <span className="tabular block text-ink-muted">
                        {formatMoney(service.priceCents, currency)}
                        {service.requiresConsultation && ' · consultation'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {picked.length > 0 && !context && (
        <Button onClick={check} disabled={busy}>
          {busy ? 'Checking…' : 'Check what this needs'}
        </Button>
      )}

      {context && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="gold">{formatMinutes(context.durationMin)}</Badge>
            <span className="tabular text-body text-ink">
              {formatMoney(context.estimatedTotalCents, currency)}
            </span>
            <span className="text-secondary text-ink-muted">
              {chosen.map((s) => s.name).join(' + ')}
            </span>
          </div>

          {blocked && (
            <div className="rounded-lg border border-line bg-danger-soft p-5">
              <p className="text-body text-ink">{gate.reason}</p>
            </div>
          )}

          {needsSignOff && (
            <div className="rounded-lg border border-line bg-warn-soft p-5">
              <p className="text-body text-ink">{gate.reason}</p>
              {context.mayOverride ? (
                <Field
                  className="mt-4"
                  label="Why is this going in without one?"
                  help="Recorded against the appointment, so whoever does the hair can see it."
                >
                  <Textarea
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    rows={2}
                    placeholder="Regular client, same colour as last four visits."
                  />
                </Field>
              ) : (
                <p className="mt-3 text-secondary text-ink-muted">
                  You cannot sign this off. Ask a manager, or start a consultation.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {canProceed && !slots && (
        <Button onClick={() => search(toDate)} disabled={busy}>
          {busy ? 'Looking…' : gap ? 'Does anything fit?' : 'Find a time'}
        </Button>
      )}

      {canProceed && slots && !selected && (
        <SlotPicker
          slots={slots}
          timeZone={timeZone}
          reason={reason}
          busy={busy}
          showStylist={!gap}
          onSelect={setSelected}
          onWiden={
            // Widening the range is meaningless when the search is pinned to
            // one gap on one day: the answer would not change, and offering
            // the button suggests otherwise.
            gap
              ? undefined
              : async () => {
                  const next = addDays(toDate, WIDEN_DAYS)
                  setToDate(next)
                  await search(next)
                }
          }
        />
      )}

      {selected && (
        <section className="flex flex-col gap-5">
          <SlotSummary slot={selected} timeZone={timeZone} />

          <Field label="Anything to note?" help="Optional.">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              placeholder="Coming straight from work, may be five minutes late."
            />
          </Field>

          <div className="flex flex-wrap gap-3">
            <Button onClick={book} disabled={busy}>
              {busy ? 'Booking…' : 'Book it'}
            </Button>
            <Button variant="secondary" onClick={() => setSelected(null)} disabled={busy}>
              Pick a different time
            </Button>
          </div>
        </section>
      )}

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
