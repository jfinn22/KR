'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { buildInvoiceAction, takePaymentAction } from '@/server/actions/commerce'
import { formatMoney } from '@/lib/format'

/**
 * The till.
 *
 * Two things it does that a naive checkout screen does not.
 *
 * The idempotency key is minted once when the screen loads and reused for
 * every attempt at the same payment. That is what makes a retry a retry: the
 * server cannot tell a double-tap from a second genuine part-payment unless
 * the client says which it is, and a key derived from the running total would
 * change the moment the first payment landed — charging twice at exactly the
 * moment a flaky connection made somebody tap again.
 *
 * The amount defaults to what is outstanding but stays editable, because part
 * payments and split bills are ordinary and a screen that assumes otherwise
 * gets worked around with cash and no record.
 */

const METHODS = [
  { key: 'CARD' as const, label: 'Card' },
  { key: 'CASH' as const, label: 'Cash' },
  { key: 'TERMINAL' as const, label: 'Terminal' },
  { key: 'GIFT_CARD' as const, label: 'Gift card' },
]

export interface TillProps {
  salonSlug: string
  appointmentId: string
  currency: string
  lines: { description: string; priceCents: number }[]
  agreedTotalCents: number
  depositHeldCents: number
  invoice: {
    id: string
    number: string
    status: string
    totalCents: number
    paidCents: number
    taxCents: number
    discountCents: number
    tipCents: number
    payments: { id: string; amountCents: number; method: string; status: string }[]
  } | null
}

export function Till({
  salonSlug,
  appointmentId,
  currency,
  lines,
  agreedTotalCents,
  depositHeldCents,
  invoice,
}: TillProps) {
  const router = useRouter()

  const [discount, setDiscount] = React.useState('')
  const [tip, setTip] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [method, setMethod] = React.useState<(typeof METHODS)[number]['key']>('CARD')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  /*
   * One key per attempt at this bill, minted on mount. Reused on every retry
   * so the server can recognise the second request as the same payment.
   */
  const [attemptKey, setAttemptKey] = React.useState(() => `till-${appointmentId}-${counter()}`)

  const outstanding = invoice
    ? Math.max(0, invoice.totalCents - invoice.paidCents)
    : Math.max(0, agreedTotalCents - depositHeldCents)

  React.useEffect(() => {
    setAmount(outstanding > 0 ? (outstanding / 100).toFixed(2) : '')
  }, [outstanding])

  async function issue() {
    setBusy(true)
    setError(null)

    const result = await buildInvoiceAction(salonSlug, {
      appointmentId,
      orderDiscountCents: discount ? Math.round(Number(discount) * 100) : undefined,
      tipCents: tip ? Math.round(Number(tip) * 100) : undefined,
    })

    if (!result.ok) {
      setError(result.error)
      setBusy(false)
      return
    }
    setBusy(false)
    router.refresh()
  }

  async function pay() {
    if (!invoice) return
    setBusy(true)
    setError(null)

    const result = await takePaymentAction(salonSlug, {
      invoiceId: invoice.id,
      amountCents: Math.round(Number(amount || '0') * 100),
      method,
      idempotencyKey: attemptKey,
    })

    if (!result.ok) {
      setError(result.error)
      setBusy(false)
      return
    }

    // A new key for the next payment: this one is spent.
    setAttemptKey(`till-${appointmentId}-${counter()}`)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border border-line bg-canvas">
        <ul className="divide-y divide-line">
          {lines.map((line, index) => (
            <li key={index} className="flex items-center justify-between gap-4 px-5 py-3">
              <span className="text-body text-ink">{line.description}</span>
              <span className="tabular text-body text-ink">
                {formatMoney(line.priceCents, currency)}
              </span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 border-t border-line px-5 py-4">
          {invoice ? (
            <>
              <Row
                label="Subtotal"
                value={formatMoney(
                  invoice.totalCents - invoice.taxCents - invoice.tipCents,
                  currency,
                )}
              />
              {invoice.discountCents > 0 && (
                <Row label="Discount" value={`− ${formatMoney(invoice.discountCents, currency)}`} />
              )}
              {invoice.taxCents > 0 && (
                <Row label="Tax" value={formatMoney(invoice.taxCents, currency)} />
              )}
              {invoice.tipCents > 0 && (
                <Row label="Tip" value={formatMoney(invoice.tipCents, currency)} />
              )}
              <Row label="Total" value={formatMoney(invoice.totalCents, currency)} strong />
              {invoice.paidCents > 0 && (
                <Row label="Paid" value={`− ${formatMoney(invoice.paidCents, currency)}`} />
              )}
            </>
          ) : (
            <>
              <Row label="Agreed" value={formatMoney(agreedTotalCents, currency)} strong />
              {depositHeldCents > 0 && (
                <Row label="Deposit held" value={`− ${formatMoney(depositHeldCents, currency)}`} />
              )}
            </>
          )}

          <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-3">
            <span className="label-caps">Still to pay</span>
            <span className="tabular font-display text-display-md text-ink">
              {formatMoney(outstanding, currency)}
            </span>
          </div>
        </div>
      </section>

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}

      {!invoice ? (
        <section className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Discount" htmlFor="discount" help="Your limit depends on your role.">
              <Input
                id="discount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </Field>
            <Field label="Tip" htmlFor="tip" help="Never taxed, never discounted.">
              <Input
                id="tip"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={tip}
                onChange={(e) => setTip(e.target.value)}
              />
            </Field>
          </div>

          <div>
            <Button onClick={issue} disabled={busy}>
              {busy ? 'Working…' : 'Produce the bill'}
            </Button>
          </div>
        </section>
      ) : invoice.status === 'PAID' ? (
        <section className="rounded-lg border border-l-4 border-line border-l-success bg-success-soft p-5">
          <p className="font-display text-display-sm text-ink">Settled</p>
          <p className="mt-1 text-secondary text-ink-muted">
            Invoice {invoice.number} · {formatMoney(invoice.totalCents, currency)} paid in full.
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            {METHODS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={method === entry.key}
                onClick={() => setMethod(entry.key)}
                className={cn(
                  'h-11 min-w-24 rounded-lg border px-4 text-secondary font-medium transition-colors',
                  method === entry.key
                    ? 'border-blue-900 bg-blue-900 text-ink-inverse'
                    : 'border-line bg-canvas text-ink hover:bg-surface-alt',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <Field
            label="Amount"
            htmlFor="amount"
            help="Defaults to what is outstanding. Change it for a split or part payment."
          >
            <Input
              id="amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              className="max-w-48"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-4">
            <Button onClick={pay} disabled={busy || !amount || Number(amount) <= 0}>
              {busy
                ? 'Taking…'
                : `Take ${amount ? formatMoney(Math.round(Number(amount) * 100), currency) : 'payment'}`}
            </Button>
            {invoice.payments.length > 0 && (
              <Badge tone="info">
                {invoice.payments.length} payment{invoice.payments.length === 1 ? '' : 's'} so far
              </Badge>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={cn('text-secondary', strong ? 'text-ink' : 'text-ink-muted')}>{label}</span>
      <span className={cn('tabular text-secondary', strong ? 'font-medium text-ink' : 'text-ink')}>
        {value}
      </span>
    </div>
  )
}

/**
 * A monotonic suffix for the attempt key.
 *
 * Not Math.random: two tills opening the same bill in the same millisecond
 * would be vanishingly unlikely to collide either way, but a counter plus the
 * appointment id is deterministic enough to reason about and cannot produce
 * the same key twice within one page.
 */
let seq = 0
function counter(): string {
  seq += 1
  return `${Date.now().toString(36)}-${seq}`
}
