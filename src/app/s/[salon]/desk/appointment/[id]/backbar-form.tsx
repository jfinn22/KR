'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { recordUsageAction } from '@/server/actions/backbar'

/**
 * Two numbers, at the bowl.
 *
 * How much colour went in, and how much was left over. Everything else — the
 * developer, the cost per gram, the share of the waste — comes off the formula
 * the stylist has already written, because anything that asks for the mix twice
 * gets it once, and the copy with the money in it is the one that gets skipped.
 *
 * The waste box is the point of the whole feature. A salon can do nothing about
 * what a tube costs and quite a lot about how much of it goes down the sink.
 */
export function BackbarForm({
  salonSlug,
  appointmentId,
  formulaId,
  cost,
}: {
  salonSlug: string
  appointmentId: string
  formulaId: string | null
  cost: {
    lines: { productName: string; grams: number; costCents: number }[]
    totalCents: number
    wasteCents: number
    marginPct: number | null
    incomplete: boolean
  } | null
}) {
  const router = useRouter()
  const [anchorGrams, setAnchorGrams] = React.useState('')
  const [wasteGrams, setWasteGrams] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (!formulaId) {
    return (
      <p className="text-secondary text-ink-muted">
        Write the formula down first — the cost comes from what is in it.
      </p>
    )
  }

  async function save() {
    setBusy(true)
    setError(null)

    const result = await recordUsageAction(salonSlug, {
      appointmentId,
      formulaId: formulaId!,
      anchorGrams: Number(anchorGrams),
      wasteGrams: wasteGrams.trim() === '' ? 0 : Number(wasteGrams),
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      {cost && (
        <div className="rounded-lg border border-line bg-surface-alt px-5 py-4">
          <ul className="flex flex-col gap-1">
            {cost.lines.map((line) => (
              <li key={line.productName} className="text-secondary text-ink-muted">
                <span className="text-ink">{line.productName}</span> — {line.grams}g,{' '}
                {money(line.costCents)}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-body text-ink">
            {money(cost.totalCents)} in the bowl
            {cost.wasteCents > 0 && `, ${money(cost.wasteCents)} of it down the sink`}
            {cost.marginPct !== null &&
              ` · ${Math.round(cost.marginPct * 100)}% left after product`}
          </p>
          {cost.incomplete && (
            <p className="mt-2 text-secondary text-warn">
              One of these has no tube size costed against it, so this is lower than the truth.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-5">
        <Field label="Colour mixed" help="Grams, as you said it at the bowl.">
          <input
            value={anchorGrams}
            onChange={(e) => setAnchorGrams(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            className="w-28 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
          />
        </Field>
        <Field label="Left over" help="What went down the sink. Optional, and the useful one.">
          <input
            value={wasteGrams}
            onChange={(e) => setWasteGrams(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            className="w-28 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
          />
        </Field>
      </div>

      {error && <p className="text-secondary text-danger">{error}</p>}

      <div>
        <Button onClick={save} disabled={busy || anchorGrams.trim() === ''}>
          {busy ? 'Working it out…' : 'Record what it cost'}
        </Button>
      </div>
    </div>
  )
}

function money(cents: number): string {
  return `${(cents / 100).toFixed(2)}`
}
