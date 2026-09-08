'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { joinWaitlistAction } from '@/server/actions/booking'
import { DAY_LABELS, EVERY_DAY, dayInMask } from '@/domain/scheduling/window'

/**
 * Getting onto the list.
 *
 * Offered at the moment somebody has just been told nothing is free, which is
 * the only moment it is genuinely useful — a waitlist link on a page where
 * times are available is noise, and one buried in a menu is never found.
 *
 * The day and time preferences are the same five fields the entry has always
 * had and nothing ever read. Asking for them is what makes an offer worth
 * receiving: "Tuesday at nine" to somebody who only does weekends is a message
 * that teaches them to ignore the next one.
 */
export function JoinWaitlist({
  salonSlug,
  clientProfileId,
  serviceIds,
  earliestDate,
  latestDate,
}: {
  salonSlug: string
  clientProfileId: string
  serviceIds: readonly string[]
  earliestDate: string
  latestDate: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [mask, setMask] = React.useState(EVERY_DAY)
  const [from, setFrom] = React.useState('')
  const [until, setUntil] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState(false)

  function toggleDay(day: number) {
    setMask((current) => current ^ (1 << day))
  }

  async function join() {
    setBusy(true)
    setError(null)
    try {
      const result = await joinWaitlistAction(salonSlug, {
        clientProfileId,
        serviceIds: [...serviceIds],
        earliestDate,
        latestDate,
        dayOfWeekMask: mask,
        ...(from ? { windowStartMinute: toMinutes(from) } : {}),
        ...(until ? { windowEndMinute: toMinutes(until) } : {}),
      })
      if (!result.ok) throw new Error(result.error)
      setDone(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add you to the list.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="wash-gold rounded-lg p-5">
        <p className="text-body text-ink">
          You are on the list. If something that suits you comes free, we will hold it and let you
          know.
        </p>
      </div>
    )
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Tell me if something comes free
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-line bg-canvas p-5">
      <div>
        <p className="text-body font-medium text-ink">When would suit?</p>
        <p className="mt-1 text-secondary text-ink-muted">
          We will only offer you times that actually fit this — and we will hold the slot while you
          decide.
        </p>
      </div>

      <fieldset>
        <legend className="label-caps mb-2">Days</legend>
        <div className="flex flex-wrap gap-2">
          {DAY_LABELS.map((label, day) => {
            const on = dayInMask(mask, day)
            return (
              <button
                key={label}
                type="button"
                onClick={() => toggleDay(day)}
                aria-pressed={on}
                className={`rounded-md border px-3 py-1.5 text-secondary transition-colors ${
                  on
                    ? 'bg-gold-soft border-gold-500 text-ink'
                    : 'border-line text-ink-muted hover:border-gold-500'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <Field label="Not before" help="Optional.">
          <Input type="time" value={from} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label="Not after" help="Optional.">
          <Input type="time" value={until} onChange={(event) => setUntil(event.target.value)} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button onClick={join} disabled={busy || mask === 0}>
          {busy ? 'Adding…' : 'Add me to the list'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Not now
        </Button>
      </div>

      {mask === 0 && <p className="text-secondary text-ink-muted">Pick at least one day.</p>}
      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** "14:30" → 870. The window fields count minutes from local midnight. */
function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}
