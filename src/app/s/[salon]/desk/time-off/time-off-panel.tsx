'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, Select } from '@/components/ui/field'
import {
  cancelTimeOffAction,
  decideTimeOffAction,
  requestTimeOffAction,
} from '@/server/actions/time-off'
import { formatDayHeading } from '@/lib/format'

interface Row {
  id: string
  stylistName: string
  startsAt: string
  endsAt: string
  allDay: boolean
  reason: string | null
  status: string
  clashes: number
}

/**
 * Asking to be away, and deciding about it.
 *
 * The clash count is on the row rather than blocking the decision. A manager
 * approving sickness on a Friday morning already knows there are clients in the
 * chair; what they need is how many of them to ring.
 */
export function TimeOffPanel({
  salonSlug,
  stylists,
  defaultStylistId,
  mayDecide,
  rows,
  timeZone,
}: {
  salonSlug: string
  stylists: { id: string; displayName: string }[]
  defaultStylistId: string
  mayDecide: boolean
  rows: Row[]
  timeZone: string
}) {
  const router = useRouter()
  const [stylistId, setStylistId] = React.useState(defaultStylistId)
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)

  async function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    setError(null)
    setNote(null)
    const result = await work()
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? 'That did not work.')
      return false
    }
    router.refresh()
    return true
  }

  async function ask() {
    if (from === '' || to === '') {
      setError('Give it a first and last day.')
      return
    }
    setBusy(true)
    setError(null)
    setNote(null)

    /*
     * Whole days, midday to midday in the salon's own zone, so a date picked
     * on a phone in another timezone still means the day the person typed.
     * `allDay` records that this is a day off rather than an hour of it.
     */
    const result = await requestTimeOffAction(salonSlug, {
      stylistProfileId: stylistId,
      startsAt: new Date(`${from}T00:00:00Z`).toISOString(),
      endsAt: new Date(`${to}T23:59:59Z`).toISOString(),
      allDay: true,
      reason: reason.trim() === '' ? null : reason.trim(),
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    setNote(
      result.data.clashes > 0
        ? `Asked for. There ${result.data.clashes === 1 ? 'is 1 appointment' : `are ${result.data.clashes} appointments`} booked in that time.`
        : 'Asked for. Nothing is booked in that time.',
    )
    setFrom('')
    setTo('')
    setReason('')
    router.refresh()
  }

  const day = (iso: string) => formatDayHeading(iso.slice(0, 10), timeZone)

  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-4 rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap gap-5">
          {stylists.length > 1 && (
            <Field label="Who">
              <Select
                value={stylistId}
                onChange={(e) => setStylistId(e.target.value)}
                className="w-48"
              >
                {stylists.map((stylist) => (
                  <option key={stylist.id} value={stylist.id}>
                    {stylist.displayName}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="First day">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
            />
          </Field>
          <Field label="Last day">
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
            />
          </Field>
        </div>

        <Field label="Why" help="Optional. Whoever decides will see it.">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Holiday"
            className="w-full max-w-md rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
          />
        </Field>

        {error && <p className="text-secondary text-danger">{error}</p>}
        {note && <p className="text-secondary text-ink">{note}</p>}

        <div>
          <Button onClick={ask} disabled={busy || stylistId === ''}>
            {busy ? 'Asking…' : 'Ask for it'}
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-body text-ink-muted">Nothing coming up.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body font-medium text-ink">{row.stylistName}</span>
                  {row.status === 'APPROVED' && <Badge tone="success">Approved</Badge>}
                  {row.status === 'REQUESTED' && <Badge tone="warn">Waiting</Badge>}
                  {row.status === 'DENIED' && <Badge tone="neutral">Turned down</Badge>}
                </div>
                <p className="tabular mt-1 text-secondary text-ink-muted">
                  {day(row.startsAt)}
                  {row.startsAt.slice(0, 10) !== row.endsAt.slice(0, 10) && ` – ${day(row.endsAt)}`}
                  {row.reason && ` · ${row.reason}`}
                </p>
                {row.clashes > 0 && row.status !== 'DENIED' && (
                  <p className="mt-1 text-secondary text-danger">
                    {row.clashes === 1
                      ? '1 appointment is booked in that time'
                      : `${row.clashes} appointments are booked in that time`}
                    {row.status === 'APPROVED' ? ' — they still need moving.' : '.'}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                {mayDecide && row.status === 'REQUESTED' && (
                  <>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          decideTimeOffAction(salonSlug, { timeOffId: row.id, approve: true }),
                        )
                      }
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          decideTimeOffAction(salonSlug, { timeOffId: row.id, approve: false }),
                        )
                      }
                    >
                      Turn it down
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run(() => cancelTimeOffAction(salonSlug, { timeOffId: row.id }))}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
