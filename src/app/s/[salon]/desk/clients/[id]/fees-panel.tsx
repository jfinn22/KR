'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/field'
import { waiveFeeAction } from '@/server/actions/commerce'
import { formatMoney } from '@/lib/format'

interface Fee {
  id: string
  appointmentId: string
  computedCents: number
  chargedCents: number
  status: string
  waiveReason: string | null
  serviceNames: string[]
  whenLabel: string
}

/**
 * Late-cancellation fees, and letting one go.
 *
 * A fee is the single most-argued-about number in a salon, and it was the one
 * number nobody behind the counter could see: `assessCancellation` wrote the
 * row, the client's card was charged, and the only screen that mentioned it
 * anywhere was the client's bank statement.
 *
 * Waiving is deliberately still possible after the fee has been assessed but
 * refused once it has been charged — at that point the money has moved and the
 * honest operation is a refund, which is a different button in a different
 * place, with a provider call behind it.
 */
export function FeesPanel({
  salonSlug,
  currency,
  fees,
}: {
  salonSlug: string
  currency: string
  fees: Fee[]
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function waive(appointmentId: string) {
    setBusy(true)
    setError(null)
    const result = await waiveFeeAction(salonSlug, { appointmentId, reason: reason.trim() })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setOpen(null)
    setReason('')
    router.refresh()
  }

  return (
    <ul className="flex flex-col divide-y divide-line border-y border-line">
      {fees.map((fee) => (
        <li key={fee.id} className="flex flex-col gap-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular text-body text-ink">
                  {formatMoney(
                    fee.status === 'CHARGED' ? fee.chargedCents : fee.computedCents,
                    currency,
                  )}
                </span>
                {fee.status === 'WAIVED' && <Badge tone="neutral">Waived</Badge>}
                {fee.status === 'CHARGED' && <Badge tone="warn">Charged</Badge>}
                {fee.status === 'PENDING' && <Badge tone="info">Not taken yet</Badge>}
                {fee.status === 'FAILED' && <Badge tone="danger">Card failed</Badge>}
              </div>
              <p className="mt-1 text-secondary text-ink-muted">
                {fee.serviceNames.join(' + ') || 'Appointment'} · {fee.whenLabel}
              </p>
              {fee.waiveReason && (
                <p className="mt-1 text-label text-ink-subtle">{fee.waiveReason}</p>
              )}
            </div>

            {fee.status === 'PENDING' && open !== fee.id && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setOpen(fee.id)
                  setReason('')
                  setError(null)
                }}
              >
                Let it go
              </Button>
            )}
            {/*
             * Said rather than hidden. A front-desk person looking for the
             * waive button on a charged fee needs to be told where the money
             * actually is, not left wondering why the button vanished.
             */}
            {fee.status === 'CHARGED' && (
              <span className="text-label text-ink-subtle">
                Already taken — refund it at the till
              </span>
            )}
          </div>

          {open === fee.id && (
            <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-alt p-4">
              <Field
                label="Why"
                htmlFor={`waive-${fee.id}`}
                help="Goes on the record against whoever is signed in."
              >
                <Textarea
                  id={`waive-${fee.id}`}
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Her train was cancelled and she rang as soon as she knew."
                />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  onClick={() => waive(fee.appointmentId)}
                  disabled={busy || reason.trim().length < 8}
                >
                  {busy ? 'Saving…' : 'Waive the fee'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(null)} disabled={busy}>
                  Cancel
                </Button>
              </div>
              {error && (
                <p role="alert" className="text-secondary text-danger">
                  {error}
                </p>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
