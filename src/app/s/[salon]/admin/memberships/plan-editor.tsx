'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field, Select, Textarea } from '@/components/ui/field'
import { saveMembershipPlanAction } from '@/server/actions/membership'

/**
 * What a membership includes.
 *
 * The benefit rows are the whole thing, and they are deliberately not free
 * text: a plan whose contents are a paragraph is a plan the till cannot apply,
 * and the salons that sell memberships successfully are the ones whose clients
 * can see the benefit land on the bill. Typed rows are what make that possible.
 */
interface Benefit {
  kind: 'FREE' | 'PERCENT_OFF' | 'FIXED_OFF'
  label: string
  serviceId: string
  value: string
  perPeriod: string
}

const EMPTY: Benefit = { kind: 'FREE', label: '', serviceId: '', value: '', perPeriod: '1' }

export function PlanEditor({
  salonSlug,
  services,
  plan,
}: {
  salonSlug: string
  services: { id: string; name: string }[]
  plan: {
    id: string
    name: string
    descriptionText: string | null
    priceCents: number
    interval: string
    isActive: boolean
    included: Benefit[]
  } | null
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(plan !== null)
  const [name, setName] = React.useState(plan?.name ?? '')
  const [description, setDescription] = React.useState(plan?.descriptionText ?? '')
  const [price, setPrice] = React.useState(plan ? String(plan.priceCents / 100) : '')
  const [interval, setInterval] = React.useState(plan?.interval ?? 'MONTH')
  const [active, setActive] = React.useState(plan?.isActive ?? true)
  const [benefits, setBenefits] = React.useState<Benefit[]>(plan?.included ?? [{ ...EMPTY }])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  function setBenefit(index: number, patch: Partial<Benefit>) {
    setBenefits((current) => current.map((b, i) => (i === index ? { ...b, ...patch } : b)))
  }

  async function save() {
    setBusy(true)
    setError(null)

    const result = await saveMembershipPlanAction(salonSlug, {
      planId: plan?.id ?? null,
      name: name.trim(),
      descriptionText: description.trim() === '' ? null : description.trim(),
      priceCents: Math.round(Number(price || 0) * 100),
      interval: interval as 'MONTH' | 'YEAR',
      isActive: active,
      included: benefits
        .filter((b) => b.label.trim() !== '')
        .map((b) => ({
          kind: b.kind,
          label: b.label.trim(),
          serviceId: b.serviceId === '' ? null : b.serviceId,
          // Percent is entered as a percentage and stored as basis points;
          // fixed is entered in pounds and stored in cents.
          value:
            b.kind === 'FREE'
              ? 0
              : b.kind === 'PERCENT_OFF'
                ? Math.round(Number(b.value || 0) * 100)
                : Math.round(Number(b.value || 0) * 100),
          perPeriod: b.perPeriod.trim() === '' ? null : Number(b.perPeriod),
        })),
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
    if (!plan) setOpen(false)
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Add a membership
      </Button>
    )
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5 rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap gap-5">
        <Field label="What it is called">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="The Colour Club"
            className="w-56 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
          />
        </Field>
        <Field label="Price">
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            className="w-28 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
          />
        </Field>
        <Field label="Every">
          <Select value={interval} onChange={(e) => setInterval(e.target.value)} className="w-32">
            <option value="MONTH">Month</option>
            <option value="YEAR">Year</option>
          </Select>
        </Field>
      </div>

      <Field label="How you describe it" help="What a client reads before joining.">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="label-caps mb-2">What it includes</legend>
        {benefits.map((benefit, index) => (
          <div key={index} className="flex flex-wrap items-center gap-3">
            <input
              aria-label={`Benefit ${index + 1}`}
              value={benefit.label}
              onChange={(e) => setBenefit(index, { label: e.target.value })}
              placeholder="A cut a month"
              className="min-w-44 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
            />
            <Select
              aria-label={`Kind ${index + 1}`}
              value={benefit.kind}
              onChange={(e) => setBenefit(index, { kind: e.target.value as Benefit['kind'] })}
              className="w-36"
            >
              <option value="FREE">Free</option>
              <option value="PERCENT_OFF">% off</option>
              <option value="FIXED_OFF">Amount off</option>
            </Select>
            {benefit.kind !== 'FREE' && (
              <input
                aria-label={`Value ${index + 1}`}
                value={benefit.value}
                onChange={(e) => setBenefit(index, { value: e.target.value.replace(/[^\d.]/g, '') })}
                placeholder={benefit.kind === 'PERCENT_OFF' ? '20' : '10'}
                className="w-20 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
              />
            )}
            <Select
              aria-label={`Service ${index + 1}`}
              value={benefit.serviceId}
              onChange={(e) => setBenefit(index, { serviceId: e.target.value })}
              className="max-w-44"
            >
              <option value="">Anything</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </Select>
            <input
              aria-label={`How many ${index + 1}`}
              value={benefit.perPeriod}
              onChange={(e) => setBenefit(index, { perPeriod: e.target.value.replace(/\D/g, '') })}
              placeholder="∞"
              title="How many per period. Empty is unlimited."
              className="w-16 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
            />
          </div>
        ))}
        <div>
          <Button variant="ghost" size="sm" onClick={() => setBenefits((c) => [...c, { ...EMPTY }])}>
            Another
          </Button>
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-body text-ink">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Available to join
      </label>

      {error && <p className="text-secondary text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy || name.trim() === ''}>
          {busy ? 'Saving…' : plan ? 'Save' : 'Create it'}
        </Button>
        {!plan && (
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}
