'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { choosePlatformPlanAction } from '@/server/actions/platform-billing'

/**
 * Picking a tier.
 *
 * Tiers the salon has outgrown, and tiers the platform has not finished
 * configuring, are shown in the list but not selectable — removing them would
 * leave an owner wondering where Starter went, and the card beside this control
 * has already said in words why each one is unavailable.
 */
export function PlanPicker({
  salonSlug,
  currentCode,
  live,
  yearly,
  plans,
}: {
  salonSlug: string
  currentCode: string
  live: boolean
  yearly: boolean
  plans: {
    code: string
    name: string
    monthlyPriceCents: number
    yearlyPriceCents: number
    blocked: boolean
  }[]
}) {
  const router = useRouter()
  /*
   * The plan the salon is on is always a legal choice — they are on it — so it
   * is the fallback rather than the first row. Defaulting to the first row
   * lands on a tier they have outgrown, which disables the button and leaves a
   * salon still on trial with no way to start paying at all.
   */
  const first =
    plans.find((plan) => !plan.blocked && plan.code !== currentCode) ??
    plans.find((plan) => plan.code === currentCode) ??
    plans[0]
  const [code, setCode] = React.useState(first?.code ?? currentCode)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)

  const chosen = plans.find((plan) => plan.code === code)
  const nothingToDo = live && code === currentCode

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          aria-label="Which plan"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="max-w-72"
        >
          {plans.map((plan) => (
            <option key={plan.code} value={plan.code} disabled={plan.blocked}>
              {plan.name} —{' '}
              {((yearly ? plan.yearlyPriceCents : plan.monthlyPriceCents) / 100).toFixed(2)}
              {plan.code === currentCode ? ' (yours)' : ''}
              {plan.blocked ? ' — unavailable' : ''}
            </option>
          ))}
        </Select>

        <Button
          disabled={busy || nothingToDo || chosen?.blocked === true}
          onClick={async () => {
            setBusy(true)
            setError(null)
            setNote(null)
            const result = await choosePlatformPlanAction(salonSlug, { planCode: code, yearly })
            setBusy(false)
            if (!result.ok) {
              setError(result.error)
              return
            }
            setNote(
              result.data.started
                ? 'That is set up. Your first payment goes out at the end of this period.'
                : 'Moved. You will be billed the difference for the rest of this period.',
            )
            router.refresh()
          }}
        >
          {busy ? 'Working…' : live ? 'Move us' : 'Start paying'}
        </Button>
      </div>

      {nothingToDo && (
        <p className="text-secondary text-ink-muted">That is the plan you are already on.</p>
      )}
      {note && <p className="text-secondary text-ink">{note}</p>}
      {error && <p className="text-secondary text-danger">{error}</p>}
    </div>
  )
}
