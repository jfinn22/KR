'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { decideReviewAction } from '@/server/actions/review'
import { formatMoney } from '@/lib/format'

/**
 * The decision.
 *
 * Six outcomes, worded as what they do to the client rather than as status
 * names. "Ask for better photos" is a thing a stylist decides; NEEDS_MORE_INFO
 * is a thing a database stores.
 *
 * The overrides start empty rather than pre-filled with the estimate. A
 * pre-filled field invites a nudge, and every nudge is recorded as the human
 * disagreeing with the engine — which poisons the calibration signal with
 * noise. Blank means "I agree", and that is the common case.
 */

const DECISIONS = [
  {
    key: 'APPROVE' as const,
    label: 'Approve',
    help: 'They get a plan and can book straight away.',
    variant: 'primary' as const,
  },
  {
    key: 'REQUEST_IN_PERSON' as const,
    label: 'Ask them to come in',
    help: 'A look in daylight before anything is agreed.',
    variant: 'secondary' as const,
  },
  {
    key: 'REQUEST_MORE_PHOTOS' as const,
    label: 'Ask for better photos',
    help: 'The estimate is a guess without them.',
    variant: 'secondary' as const,
  },
  {
    key: 'REQUEST_MORE_INFO' as const,
    label: 'Ask a question',
    help: 'Something in the answers needs clarifying.',
    variant: 'secondary' as const,
  },
  {
    key: 'DECLINE' as const,
    label: 'Decline',
    help: 'Not something this salon should take on.',
    variant: 'danger-quiet' as const,
  },
]

type DecisionKey = (typeof DECISIONS)[number]['key']

export interface DecisionPanelProps {
  salonSlug: string
  consultationId: string
  currency: string
  decided: boolean
  servicePlanId: string | null
  recommended: string
  estimate: { durationMin: number; priceCents: number; depositCents: number } | null
  stylists: { id: string; name: string }[]
  currentStylistId: string | null
}

export function DecisionPanel({
  salonSlug,
  consultationId,
  currency,
  decided,
  servicePlanId,
  recommended,
  estimate,
  stylists,
  currentStylistId,
}: DecisionPanelProps) {
  const router = useRouter()

  const [chosen, setChosen] = React.useState<DecisionKey | null>(null)
  const [notesToClient, setNotesToClient] = React.useState('')
  const [notesInternal, setNotesInternal] = React.useState('')
  const [durationMin, setDurationMin] = React.useState('')
  const [price, setPrice] = React.useState('')
  const [deposit, setDeposit] = React.useState('')
  const [stylistId, setStylistId] = React.useState(currentStylistId ?? '')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (decided) {
    return (
      <section className="rounded-lg border border-line bg-surface p-6">
        <h2 className="font-display text-display-sm text-ink">Already decided</h2>
        <p className="mt-2 text-secondary text-ink-muted">
          This consultation has been dealt with. Re-evaluating it would detach the decision from
          what the reviewer actually saw.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {servicePlanId && (
            <Button variant="secondary" asChild>
              <Link href={`/s/${salonSlug}/review`}>Back to the queue</Link>
            </Button>
          )}
        </div>
      </section>
    )
  }

  const changedStylist = stylistId !== '' && stylistId !== (currentStylistId ?? '')
  const overrides = {
    durationMin: durationMin === '' ? null : Number(durationMin),
    priceCents: price === '' ? null : Math.round(Number(price) * 100),
    depositCents: deposit === '' ? null : Math.round(Number(deposit) * 100),
    stylistProfileId: changedStylist ? stylistId : null,
  }
  const hasOverride = Object.values(overrides).some((v) => v !== null)

  async function decide(decision: DecisionKey) {
    setBusy(true)
    setError(null)
    setChosen(decision)

    const result = await decideReviewAction(salonSlug, {
      consultationId,
      decision,
      notesToClient: notesToClient.trim() || null,
      notesInternal: notesInternal.trim() || null,
      overrides: decision === 'APPROVE' && hasOverride ? overrides : undefined,
    })

    if (!result.ok) {
      setError(result.error)
      setBusy(false)
      setChosen(null)
      return
    }
    router.refresh()
    router.push(`/s/${salonSlug}/review`)
  }

  return (
    <section className="rounded-lg border border-line bg-canvas p-6 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-display-md text-ink">Your decision</h2>
        {recommended === 'AUTO_APPROVE_ELIGIBLE' && <Badge tone="success">Nothing flagged</Badge>}
        {recommended === 'REQUIRE_IN_PERSON' && <Badge tone="warn">Better seen in person</Badge>}
        {recommended === 'DECLINE_ONLINE' && <Badge tone="danger">Not safe to book online</Badge>}
      </div>

      {estimate && (
        <div className="mt-6">
          <p className="label-caps mb-3">
            Change anything you disagree with — blank means you agree
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Minutes" htmlFor="ov-duration" help={`Suggested ${estimate.durationMin}`}>
              <Input
                id="ov-duration"
                type="number"
                inputMode="numeric"
                min={5}
                step={5}
                value={durationMin}
                placeholder={String(estimate.durationMin)}
                onChange={(e) => setDurationMin(e.target.value)}
              />
            </Field>

            <Field
              label="Price"
              htmlFor="ov-price"
              help={`Suggested ${formatMoney(estimate.priceCents, currency)}`}
            >
              <Input
                id="ov-price"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={price}
                placeholder={(estimate.priceCents / 100).toFixed(2)}
                onChange={(e) => setPrice(e.target.value)}
              />
            </Field>

            <Field
              label="Deposit"
              htmlFor="ov-deposit"
              help={`Suggested ${formatMoney(estimate.depositCents, currency)}`}
            >
              <Input
                id="ov-deposit"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={deposit}
                placeholder={(estimate.depositCents / 100).toFixed(2)}
                onChange={(e) => setDeposit(e.target.value)}
              />
            </Field>

            <Field label="Stylist" htmlFor="ov-stylist" help="Who should take this">
              <Select
                id="ov-stylist"
                value={stylistId}
                onChange={(e) => setStylistId(e.target.value)}
              >
                <option value="">Whoever is free</option>
                {stylists.map((stylist) => (
                  <option key={stylist.id} value={stylist.id}>
                    {stylist.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {hasOverride && (
            <p className="mt-3 text-secondary text-gold-700">
              Recorded as an approval with changes, so the engine can learn from the difference.
            </p>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field
          label="What the client sees"
          htmlFor="notes-client"
          help="Goes out with the decision. Say it the way you would in the chair."
        >
          <Textarea
            id="notes-client"
            rows={3}
            value={notesToClient}
            onChange={(e) => setNotesToClient(e.target.value)}
          />
        </Field>

        <Field label="Note for the team" htmlFor="notes-internal" help="Never shown to the client.">
          <Textarea
            id="notes-internal"
            rows={3}
            value={notesInternal}
            onChange={(e) => setNotesInternal(e.target.value)}
          />
        </Field>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-secondary text-danger">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3 border-t border-line pt-6">
        {DECISIONS.map((decision) => (
          <div
            key={decision.key}
            className={cn(
              'flex flex-wrap items-center justify-between gap-4',
              busy && chosen !== decision.key && 'opacity-50',
            )}
          >
            <p className="text-secondary text-ink-muted">{decision.help}</p>
            <Button
              variant={decision.variant}
              disabled={busy}
              onClick={() => decide(decision.key)}
              className="min-w-52"
            >
              {busy && chosen === decision.key ? 'Saving…' : decision.label}
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}
