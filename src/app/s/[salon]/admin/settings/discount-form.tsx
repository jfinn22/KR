'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { saveDiscountReasonAction } from '@/server/actions/commerce'
import { formatMoney } from '@/lib/format'

/**
 * The reasons a bill can be less than the price list.
 *
 * Written by the owner, chosen by whoever is at the till. That split is the
 * point: the person who decides a staff discount is 50% is not the person
 * standing in front of the client at half past six, and a till with a free
 * text box makes them the same person by accident.
 *
 * The role cap is deliberately NOT editable here. It is the platform's floor —
 * what stops an assistant zeroing a bill — and a salon that wants to raise it
 * is asking for a different feature.
 */

export interface DiscountRow {
  id: string
  label: string
  kind: 'PERCENT' | 'FIXED' | 'OPEN'
  value: number
  maxCents: number | null
  isActive: boolean
  sortOrder: number
}

export function DiscountForm({
  salonSlug,
  currency,
  initial,
}: {
  salonSlug: string
  currency: string
  initial: DiscountRow[]
}) {
  const router = useRouter()
  const [editing, setEditing] = React.useState<DiscountRow | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save(row: DiscountRow) {
    setBusy(true)
    setError(null)

    const result = await saveDiscountReasonAction(salonSlug, {
      id: row.id || null,
      label: row.label,
      kind: row.kind,
      value: row.value,
      maxCents: row.maxCents,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    })

    if (!result.ok) {
      setError(result.error)
      setBusy(false)
      return
    }
    setEditing(null)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      {initial.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-canvas">
          {initial.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div>
                <p className="text-body text-ink">{row.label}</p>
                <p className="text-secondary text-ink-muted">
                  {describe(row, currency)}
                  {row.maxCents != null &&
                    ` · never more than ${formatMoney(row.maxCents, currency)}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {!row.isActive && <Badge tone="warn">Retired</Badge>}
                <button
                  type="button"
                  onClick={() => setEditing(row)}
                  className="text-secondary text-blue-700 underline underline-offset-4"
                >
                  Edit
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}

      {editing ? (
        <Editor
          row={editing}
          currency={currency}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      ) : (
        <div>
          <Button
            variant="secondary"
            onClick={() =>
              setEditing({
                id: '',
                label: '',
                kind: 'PERCENT',
                value: 1_000,
                maxCents: null,
                isActive: true,
                sortOrder: initial.length,
              })
            }
          >
            Add a reason
          </Button>
        </div>
      )}
    </div>
  )
}

function describe(row: DiscountRow, currency: string): string {
  if (row.kind === 'PERCENT') return `${row.value / 100}% off the bill`
  if (row.kind === 'FIXED') return `${formatMoney(row.value, currency)} off`
  return 'The amount is named at the till'
}

function Editor({
  row,
  currency,
  busy,
  onCancel,
  onSave,
}: {
  row: DiscountRow
  currency: string
  busy: boolean
  onCancel: () => void
  onSave: (row: DiscountRow) => void
}) {
  const [draft, setDraft] = React.useState(row)
  const set = (patch: Partial<DiscountRow>) => setDraft((d) => ({ ...d, ...patch }))

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="What to call it" htmlFor="d-label" help="What the till will show.">
          <Input
            id="d-label"
            value={draft.label}
            placeholder="Colour redone"
            onChange={(e) => set({ label: e.target.value })}
          />
        </Field>

        <Field label="How it works" htmlFor="d-kind">
          <Select
            id="d-kind"
            value={draft.kind}
            onChange={(e) => set({ kind: e.target.value as DiscountRow['kind'] })}
          >
            <option value="PERCENT">A percentage</option>
            <option value="FIXED">A set amount</option>
            <option value="OPEN">Named at the till</option>
          </Select>
        </Field>

        {draft.kind !== 'OPEN' && (
          <Field
            label={draft.kind === 'PERCENT' ? 'Percent' : 'Amount'}
            htmlFor="d-value"
            help={draft.kind === 'PERCENT' ? 'Of the whole bill.' : undefined}
          >
            <Input
              id="d-value"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={draft.kind === 'PERCENT' ? draft.value / 100 : draft.value / 100}
              onChange={(e) => set({ value: Math.round(Number(e.target.value) * 100) })}
            />
          </Field>
        )}

        <Field
          label="Never more than"
          htmlFor="d-max"
          // A 20% staff discount on a £450 correction is £90, which is more
          // than most owners mean by "staff discount".
          help="Leave blank for no ceiling."
        >
          <Input
            id="d-max"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={draft.maxCents == null ? '' : (draft.maxCents / 100).toFixed(2)}
            onChange={(e) =>
              set({
                maxCents: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
              })
            }
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-secondary text-ink">
        <input
          type="checkbox"
          checked={draft.isActive}
          onChange={(e) => set({ isActive: e.target.checked })}
          className="h-4 w-4 rounded border-line"
        />
        {/*
         * Retired rather than deleted. Bills already carry this reason, and
         * deleting it would make last month's numbers unexplainable.
         */}
        Offer this at the till
      </label>

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => onSave(draft)} disabled={busy || draft.label.trim().length < 2}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {draft.kind === 'PERCENT' && draft.value > 0 && (
          <span className="self-center text-secondary text-ink-muted">
            {formatMoney(Math.round((draft.value / 10_000) * 10_000), currency)} on a{' '}
            {formatMoney(10_000, currency)} bill
          </span>
        )}
      </div>
    </div>
  )
}
