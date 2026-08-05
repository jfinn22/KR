'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import {
  buildInvoiceAction,
  previewInvoiceAction,
  redeemGiftCardAction,
  takePaymentAction,
} from '@/server/actions/commerce'
import { formatMoney } from '@/lib/format'

/**
 * The till.
 *
 * Three things it does that a naive checkout screen does not.
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
 *
 * And the bill is priced by the server before it is produced. Everything on
 * this screen — a line added, a price edited, a discount chosen — changes what
 * is owed, and every one of those figures has to come back from the same code
 * that will write the invoice. A till that adds up its own total is a till
 * that can be argued with.
 */

const METHODS = [
  { key: 'CARD' as const, label: 'Card' },
  { key: 'CASH' as const, label: 'Cash' },
  { key: 'TERMINAL' as const, label: 'Terminal' },
]

export interface TillLine {
  appointmentServiceId: string | null
  description: string
  quantity: number
  unitPriceCents: number
  kind: 'SERVICE' | 'RETAIL' | 'FEE' | 'GIFT_CARD'
  /** What the client agreed to, for a service line. Null for one added here. */
  agreedCents: number | null
}

export interface DiscountOption {
  id: string
  label: string
  kind: 'PERCENT' | 'FIXED' | 'OPEN'
  value: number
  maxCents: number | null
}

export interface TillProps {
  salonSlug: string
  appointmentId: string
  currency: string
  lines: { appointmentServiceId: string; description: string; priceCents: number }[]
  agreedTotalCents: number
  depositHeldCents: number
  discountOptions: DiscountOption[]
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

interface Preview {
  subtotalCents: number
  discountCents: number
  repricedDownCents: number
  taxCents: number
  totalCents: number
  dueCents: number
  discountLabel: string | null
  withinCap: boolean
  capCents: number
  overByCents: number
}

export function Till({
  salonSlug,
  appointmentId,
  currency,
  lines: agreedLines,
  agreedTotalCents,
  depositHeldCents,
  discountOptions,
  invoice,
}: TillProps) {
  const router = useRouter()

  const [lines, setLines] = React.useState<TillLine[]>(() =>
    agreedLines.map((line) => ({
      appointmentServiceId: line.appointmentServiceId,
      description: line.description,
      quantity: 1,
      unitPriceCents: line.priceCents,
      kind: 'SERVICE' as const,
      agreedCents: line.priceCents,
    })),
  )
  const [discountReasonId, setDiscountReasonId] = React.useState('')
  const [openAmount, setOpenAmount] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [tip, setTip] = React.useState('')
  const [preview, setPreview] = React.useState<Preview | null>(null)

  const [amount, setAmount] = React.useState('')
  const [method, setMethod] = React.useState<(typeof METHODS)[number]['key']>('CARD')
  const [giftCode, setGiftCode] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [attemptKey, setAttemptKey] = React.useState(() => `till-${appointmentId}-${counter()}`)

  const chosenReason = discountOptions.find((option) => option.id === discountReasonId) ?? null
  const outstanding = invoice
    ? Math.max(0, invoice.totalCents - invoice.paidCents)
    : (preview?.dueCents ?? Math.max(0, agreedTotalCents - depositHeldCents))

  React.useEffect(() => {
    setAmount(outstanding > 0 ? (outstanding / 100).toFixed(2) : '')
  }, [outstanding])

  const billPayload = React.useMemo(
    () => ({
      appointmentId,
      lines: lines.map((line) => ({
        appointmentServiceId: line.appointmentServiceId,
        description: line.description,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        kind: line.kind,
      })),
      discountReasonId: discountReasonId || null,
      discountRequestedCents: openAmount ? Math.round(Number(openAmount) * 100) : undefined,
      reason: reason.trim() || undefined,
      tipCents: tip ? Math.round(Number(tip) * 100) : undefined,
    }),
    [appointmentId, lines, discountReasonId, openAmount, reason, tip],
  )

  /*
   * Re-priced by the server on every change, debounced. The alternative is
   * adding up in the browser and finding out at the last tap that the server
   * disagreed — which on this screen means a number said out loud to somebody
   * standing there with a card in their hand.
   */
  React.useEffect(() => {
    if (invoice) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const result = await previewInvoiceAction(salonSlug, billPayload)
      if (cancelled) return
      if (result.ok) setPreview(result.data)
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [salonSlug, billPayload, invoice])

  function updateLine(index: number, patch: Partial<TillLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  function addLine(kind: TillLine['kind']) {
    setLines((current) => [
      ...current,
      {
        appointmentServiceId: null,
        description: kind === 'GIFT_CARD' ? 'Gift card' : '',
        quantity: 1,
        unitPriceCents: 0,
        kind,
        agreedCents: null,
      },
    ])
  }

  async function issue() {
    setBusy(true)
    setError(null)

    const result = await buildInvoiceAction(salonSlug, billPayload)
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

  async function payWithCard() {
    if (!invoice) return
    setBusy(true)
    setError(null)

    const result = await redeemGiftCardAction(salonSlug, {
      invoiceId: invoice.id,
      code: giftCode.trim(),
      amountCents: Math.round(Number(amount || '0') * 100),
      idempotencyKey: attemptKey,
    })

    if (!result.ok) {
      setError(result.error)
      setBusy(false)
      return
    }

    setAttemptKey(`till-${appointmentId}-${counter()}`)
    setGiftCode('')
    setBusy(false)
    router.refresh()
  }

  const needsReason = preview !== null && !preview.withinCap
  const reasonTooShort = needsReason && reason.trim().length < 8

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border border-line bg-canvas">
        {invoice ? (
          <ul className="divide-y divide-line">
            {lines.map((line, index) => (
              <li key={index} className="flex items-center justify-between gap-4 px-5 py-3">
                <span className="text-body text-ink">{line.description}</span>
                <span className="tabular text-body text-ink">
                  {formatMoney(line.unitPriceCents * line.quantity, currency)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-line">
            {lines.map((line, index) => (
              <LineRow
                key={index}
                line={line}
                currency={currency}
                onChange={(patch) => updateLine(index, patch)}
                onRemove={
                  line.appointmentServiceId
                    ? undefined
                    : () => setLines((current) => current.filter((_, i) => i !== index))
                }
              />
            ))}
          </ul>
        )}

        {!invoice && (
          <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
            <Button variant="secondary" size="sm" onClick={() => addLine('RETAIL')}>
              + Add a line
            </Button>
            <Button variant="secondary" size="sm" onClick={() => addLine('GIFT_CARD')}>
              + Sell a gift card
            </Button>
          </div>
        )}

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
          ) : preview ? (
            <>
              <Row label="Subtotal" value={formatMoney(preview.subtotalCents, currency)} />
              {preview.repricedDownCents > 0 && (
                <Row
                  label="Prices reduced at the till"
                  value={`− ${formatMoney(preview.repricedDownCents, currency)}`}
                />
              )}
              {preview.discountCents > 0 && (
                <Row
                  label={preview.discountLabel ?? 'Discount'}
                  value={`− ${formatMoney(preview.discountCents, currency)}`}
                />
              )}
              {preview.taxCents > 0 && (
                <Row label="Tax" value={formatMoney(preview.taxCents, currency)} />
              )}
              <Row label="Total" value={formatMoney(preview.totalCents, currency)} strong />
              {depositHeldCents > 0 && (
                <Row label="Deposit held" value={`− ${formatMoney(depositHeldCents, currency)}`} />
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
            {/*
             * A dropdown rather than a number, because the amount is the least
             * interesting part. "£30 off" tells a manager nothing; "colour had
             * to be redone" tells them where to look.
             */}
            <Field
              label="Discount"
              htmlFor="discount-reason"
              help={
                discountOptions.length === 0
                  ? 'None set up yet — an owner adds these in settings.'
                  : 'Pick why, and the amount follows.'
              }
            >
              <Select
                id="discount-reason"
                value={discountReasonId}
                disabled={discountOptions.length === 0}
                onChange={(e) => setDiscountReasonId(e.target.value)}
              >
                <option value="">No discount</option>
                {discountOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                    {option.kind === 'PERCENT' ? ` — ${option.value / 100}%` : ''}
                    {option.kind === 'FIXED' ? ` — ${formatMoney(option.value, currency)}` : ''}
                  </option>
                ))}
              </Select>
            </Field>

            {chosenReason?.kind === 'OPEN' ? (
              <Field label="How much" htmlFor="discount-amount" help="This reason has no set rate.">
                <Input
                  id="discount-amount"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={openAmount}
                  onChange={(e) => setOpenAmount(e.target.value)}
                />
              </Field>
            ) : (
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
            )}
          </div>

          {/*
           * Over the cap is an escalation, not a refusal. A system that only
           * says no gets worked around with cash and no record — so there is
           * always a way through, and it is always written down.
           */}
          {needsReason && (
            <div className="rounded-lg border border-l-4 border-line border-l-gold-500 bg-gold-100/40 p-4">
              <p className="text-secondary text-ink">
                That is {formatMoney(preview!.overByCents, currency)} over your limit of{' '}
                {formatMoney(preview!.capCents, currency)} on this bill.
              </p>
              <div className="mt-3">
                <Field
                  label="Why"
                  htmlFor="over-cap-reason"
                  help="Goes on the record with your name against it."
                  error={
                    reason.length > 0 && reasonTooShort ? 'A few more words, please.' : undefined
                  }
                >
                  <Textarea
                    id="over-cap-reason"
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              </div>
            </div>
          )}

          <div>
            <Button onClick={issue} disabled={busy || reasonTooShort}>
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
                    ? 'border-blue-500 bg-blue-500 text-ink-inverse shadow-raised'
                    : 'border-blue-300/50 bg-canvas text-ink hover:border-blue-500 hover:bg-blue-50',
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

          {/*
           * A gift card is money the salon already took. Spending it is
           * settlement, not a discount — so it goes through as a payment, and
           * the bill's own subtotal stays the figure that was actually charged.
           */}
          <div className="border-t border-line pt-5">
            <Field
              label="Gift card"
              htmlFor="gift-code"
              help="Applies the amount above, or whatever is left on the card if that is less."
            >
              <div className="flex flex-wrap gap-3">
                <Input
                  id="gift-code"
                  className="max-w-56 uppercase"
                  placeholder="XXXXX-XXXXX"
                  value={giftCode}
                  onChange={(e) => setGiftCode(e.target.value)}
                />
                <Button
                  variant="secondary"
                  onClick={payWithCard}
                  disabled={busy || giftCode.trim().length < 4}
                >
                  Apply card
                </Button>
              </div>
            </Field>
          </div>
        </section>
      )}
    </div>
  )
}

/**
 * One editable line.
 *
 * The agreed price stays visible beside the edited one rather than being
 * replaced by it. A front desk changing 95 to 80 should see both numbers while
 * they do it — and so should the person who reads the bill afterwards.
 */
function LineRow({
  line,
  currency,
  onChange,
  onRemove,
}: {
  line: TillLine
  currency: string
  onChange: (patch: Partial<TillLine>) => void
  onRemove?: () => void
}) {
  const reduced = line.agreedCents !== null && line.unitPriceCents < line.agreedCents

  return (
    <li className="flex flex-wrap items-end gap-3 px-5 py-3">
      <div className="min-w-40 flex-1">
        {line.appointmentServiceId ? (
          <p className="text-body text-ink">{line.description}</p>
        ) : (
          <Input
            aria-label="What it is"
            placeholder={line.kind === 'GIFT_CARD' ? 'Gift card' : 'What it is'}
            value={line.description}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        )}
        {reduced && (
          <p className="mt-1 text-label text-gold-700">
            Agreed {formatMoney(line.agreedCents!, currency)} — counts toward your discount limit.
          </p>
        )}
      </div>

      <Input
        aria-label="Price"
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        className="w-28 text-right"
        value={(line.unitPriceCents / 100).toFixed(2)}
        onChange={(e) => onChange({ unitPriceCents: Math.round(Number(e.target.value) * 100) })}
      />

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="pb-3 text-label text-blue-500 underline-offset-2 hover:underline"
        >
          Remove
        </button>
      )}
    </li>
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
