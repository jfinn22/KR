'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/field'
import { forfeitDepositAction, releaseDepositAction } from '@/server/actions/cards'
import { formatMoney } from '@/lib/format'

interface DepositView {
  id: string
  amountCents: number
  status: string
  serviceNames: string[]
  whenLabel: string | null
  expiresLabel: string | null
}

const TONE: Record<string, 'info' | 'warn' | 'danger' | 'neutral' | 'success' | 'gold'> = {
  PENDING: 'neutral',
  AUTHORIZED: 'gold',
  CAPTURED: 'success',
  FORFEITED: 'warn',
  FAILED: 'danger',
}

const WORDS: Record<string, string> = {
  PENDING: 'Not held yet',
  AUTHORIZED: 'Held',
  CAPTURED: 'Taken',
  FORFEITED: 'Kept',
  FAILED: 'Card refused',
}

/**
 * Deposits, and the two decisions a person has to make about one.
 *
 * Both operations were built and reachable from nowhere. The cost of that is
 * asymmetric and worth stating: an authorisation nobody releases does not
 * quietly disappear, it sits on the client's statement for days looking
 * exactly like a charge — which produces the phone call the deposit existed to
 * prevent.
 *
 * Keeping one takes money from somebody who is not in the room, so the reason
 * is required before the button works rather than after.
 */
export function DepositsPanel({
  salonSlug,
  currency,
  deposits,
}: {
  salonSlug: string
  currency: string
  deposits: DepositView[]
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState<{ id: string; mode: 'keep' | 'release' } | null>(null)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function submit(depositId: string, mode: 'keep' | 'release') {
    setBusy(true)
    setError(null)
    const result =
      mode === 'keep'
        ? await forfeitDepositAction(salonSlug, { depositId, reason: reason.trim() })
        : await releaseDepositAction(salonSlug, { depositId, reason: reason.trim() })
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
      {deposits.map((deposit) => {
        const decidable = deposit.status === 'AUTHORIZED' || deposit.status === 'CAPTURED'
        const active = open?.id === deposit.id

        return (
          <li key={deposit.id} className="flex flex-col gap-3 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular text-body text-ink">
                    {formatMoney(deposit.amountCents, currency)}
                  </span>
                  <Badge tone={TONE[deposit.status] ?? 'neutral'}>
                    {WORDS[deposit.status] ?? deposit.status.toLowerCase()}
                  </Badge>
                </div>
                <p className="mt-1 text-secondary text-ink-muted">
                  {deposit.serviceNames.join(' + ') || 'Against a plan'}
                  {deposit.whenLabel ? ` · ${deposit.whenLabel}` : ''}
                </p>
                {/*
                 * The expiry, said out loud. A hold the salon forgets about
                 * does not lapse silently for the client — it lapses on their
                 * statement, days later, after they have already rung.
                 */}
                {deposit.expiresLabel && deposit.status === 'AUTHORIZED' && (
                  <p className="mt-1 text-label text-ink-subtle">
                    Hold lapses {deposit.expiresLabel}
                  </p>
                )}
              </div>

              {decidable && !active && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setOpen({ id: deposit.id, mode: 'release' })
                      setReason('')
                      setError(null)
                    }}
                  >
                    Let it go
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setOpen({ id: deposit.id, mode: 'keep' })
                      setReason('')
                      setError(null)
                    }}
                  >
                    Keep it
                  </Button>
                </div>
              )}
            </div>

            {active && open && (
              <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-alt p-4">
                <Field
                  label="Why"
                  htmlFor={`deposit-reason-${deposit.id}`}
                  help={
                    open.mode === 'keep'
                      ? 'Goes on the record. They will see this money gone and may well ring about it.'
                      : 'Goes on the record.'
                  }
                >
                  <Textarea
                    id={`deposit-reason-${deposit.id}`}
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={
                      open.mode === 'keep'
                        ? 'Did not turn up and did not ring.'
                        : 'Rang two days ahead; rebooked for the 20th.'
                    }
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    onClick={() => submit(deposit.id, open.mode)}
                    disabled={busy || reason.trim().length < 4}
                  >
                    {busy
                      ? 'Saving…'
                      : open.mode === 'keep'
                        ? `Keep ${formatMoney(deposit.amountCents, currency)}`
                        : 'Release the hold'}
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
        )
      })}
    </ul>
  )
}
