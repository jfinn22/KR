'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import {
  cancelMembershipAction,
  changeMembershipPlanAction,
  subscribeClientAction,
} from '@/server/actions/membership'

/**
 * The client's membership, at the desk.
 *
 * Everything visible at once, including what they have already used this
 * period, because the question the desk actually gets asked is "have I still
 * got my free cut this month" and looking it up somewhere else is how they end
 * up guessing.
 */
export function MembershipPanel({
  salonSlug,
  clientProfileId,
  plans,
  membership,
}: {
  salonSlug: string
  clientProfileId: string
  plans: { id: string; name: string; priceCents: number; interval: string }[]
  membership: {
    id: string
    planId: string
    planName: string
    priceCents: number
    status: string
    renewsAt: string | null
    cancelAtPeriodEnd: boolean
    suspended: boolean
    benefits: { label: string; used: number; allowance: number | null }[]
  } | null
}) {
  const router = useRouter()
  const [planId, setPlanId] = React.useState(plans[0]?.id ?? '')
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

  if (!membership) {
    if (plans.length === 0) {
      return <p className="text-secondary text-ink-muted">This salon has no memberships on offer.</p>
    }
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            aria-label="Which membership"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            className="max-w-64"
          >
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} — {(plan.priceCents / 100).toFixed(2)}/{plan.interval.toLowerCase()}
              </option>
            ))}
          </Select>
          <Button
            disabled={busy || planId === ''}
            onClick={() =>
              run(() => subscribeClientAction(salonSlug, { clientProfileId, planId }))
            }
          >
            {busy ? 'Starting…' : 'Start it'}
          </Button>
        </div>
        {/* Said before they press it, not after — a card is something the
            client has to hand over, and they are standing right there. */}
        <p className="text-secondary text-ink-muted">
          They need a card on file first. A membership with no way to take the second payment is one
          that fails next month.
        </p>
        {error && <p className="text-secondary text-danger">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display text-display-sm text-ink">{membership.planName}</span>
        <span className="text-body text-ink-muted">
          {(membership.priceCents / 100).toFixed(2)}
        </span>
        {membership.suspended && <Badge tone="warn">Benefits paused</Badge>}
        {membership.cancelAtPeriodEnd && <Badge tone="neutral">Ends at the period</Badge>}
        {membership.status === 'PAST_DUE' && <Badge tone="danger">Payment failed</Badge>}
      </div>

      {membership.renewsAt && (
        <p className="text-secondary text-ink-muted">
          {membership.cancelAtPeriodEnd ? 'Runs until' : 'Renews'}{' '}
          {new Date(membership.renewsAt).toLocaleDateString()}
        </p>
      )}

      {membership.benefits.length > 0 && (
        <ul className="flex flex-col gap-1">
          {membership.benefits.map((benefit) => (
            <li key={benefit.label} className="text-secondary text-ink-muted">
              <span className="text-ink">{benefit.label}</span>
              {benefit.allowance === null
                ? ' — as often as they like'
                : ` — ${Math.max(0, benefit.allowance - benefit.used)} of ${benefit.allowance} left this period`}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Select
          aria-label="Move to"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          className="max-w-64"
        >
          {plans
            .filter((plan) => plan.id !== membership.planId)
            .map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} — {(plan.priceCents / 100).toFixed(2)}
              </option>
            ))}
        </Select>
        <Button
          variant="secondary"
          disabled={busy || planId === membership.planId}
          onClick={async () => {
            const result = await changeMembershipPlanAction(salonSlug, {
              membershipId: membership.id,
              newPlanId: planId,
            })
            if (!result.ok) {
              setError(result.error)
              return
            }
            /*
             * Both numbers, not just the net. "You have £15 left on the old one
             * and the new one is £25 for the rest of the month" is a
             * conversation; "that will be £10" is a dispute waiting to happen.
             */
            const p = result.data.proration
            setNote(
              `${(p.creditCents / 100).toFixed(2)} left on the old one, ${(p.chargeCents / 100).toFixed(2)} for the rest of this one — ${(Math.abs(p.netCents) / 100).toFixed(2)} ${p.netCents >= 0 ? 'to pay' : 'back to them'}.`,
            )
            router.refresh()
          }}
        >
          Move them
        </Button>
      </div>

      {note && <p className="text-secondary text-ink">{note}</p>}
      {error && <p className="text-secondary text-danger">{error}</p>}

      {!membership.cancelAtPeriodEnd && (
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run(() => cancelMembershipAction(salonSlug, { membershipId: membership.id }))
            }
          >
            Stop it
          </Button>
          <p className="text-secondary text-ink-muted">
            They keep it until the period they have paid for runs out.
          </p>
        </div>
      )}
    </div>
  )
}
