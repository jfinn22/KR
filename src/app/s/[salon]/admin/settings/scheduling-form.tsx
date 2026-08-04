'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { saveSchedulingSettingsAction } from '@/server/actions/settings'
import type { SchedulingSettingsView } from '@/server/services/settings'

/**
 * The interleaving controls.
 *
 * These were DB-only until now, which meant the single highest-value thing the
 * scheduler can do — hand a stylist's processing time to another client — was
 * off for every salon with no way to turn it on. The phase editor described the
 * gap in gold and the solver quietly refused to sell it.
 */
export function SchedulingSettingsForm({
  salonSlug,
  initial,
}: {
  salonSlug: string
  initial: SchedulingSettingsView
}) {
  const router = useRouter()
  const [value, setValue] = React.useState(initial)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)

  const dirty = JSON.stringify(value) !== JSON.stringify(initial)

  async function save() {
    setBusy(true)
    setError(null)
    setStatus(null)

    const result = await saveSchedulingSettingsAction(salonSlug, value)
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    setStatus('Saved')
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      <label className="flex max-w-prose cursor-pointer items-start gap-3 rounded-lg border border-line bg-canvas p-4">
        <input
          type="checkbox"
          checked={value.interleaveEnabled}
          onChange={(e) => {
            setValue({ ...value, interleaveEnabled: e.target.checked })
            setStatus(null)
          }}
          className="mt-1 size-4 shrink-0 accent-blue-500"
        />
        <span>
          <span className="text-body font-medium text-ink">
            Let the calendar sell processing time
          </span>
          <span className="mt-1 block text-secondary text-ink-muted">
            While a colour develops, the stylist is free. With this on, that gap can be offered to
            another client — the same stylist, the same day, one more booking.
          </span>
        </span>
      </label>

      <div className="grid max-w-prose gap-4 sm:grid-cols-2">
        <Field
          label="Shortest gap worth selling"
          htmlFor="minInterleaveMin"
          help="Below this the handover costs more than the gap returns. 25 minutes is a sensible floor."
        >
          <Input
            id="minInterleaveMin"
            type="number"
            min={10}
            max={120}
            value={value.minInterleaveMin}
            onChange={(e) => {
              setValue({ ...value, minInterleaveMin: Number(e.target.value) })
              setStatus(null)
            }}
          />
        </Field>

        <Field
          label="Most clients at once"
          htmlFor="maxConcurrentClients"
          help="Per stylist. Two is normal; three is busy and needs an assistant."
        >
          <Input
            id="maxConcurrentClients"
            type="number"
            min={1}
            max={6}
            value={value.maxConcurrentClients}
            onChange={(e) => {
              setValue({ ...value, maxConcurrentClients: Number(e.target.value) })
              setStatus(null)
            }}
          />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <span aria-live="polite" className="text-label text-ink-subtle">
          {error ? null : status}
        </span>
      </div>

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
