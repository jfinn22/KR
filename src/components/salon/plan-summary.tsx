import * as React from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { RiskFlagCard } from '@/components/ui/feedback'
import type { EvaluationResult, ResolvedRiskFlag } from '@/domain/consultation/types'
import { formatDuration, formatMoney } from '@/lib/format'

/**
 * What the engine concluded, told to the client.
 *
 * The whole product rests on this screen being honest and readable. Three
 * rules it follows:
 *
 *  - Use `clientExplanation`, never `detail`. The stylist-facing text says
 *    "underlying pigment at level 5 with box dye present"; the client-facing
 *    text says why that means two visits.
 *  - Every flag shows what to do about it. A flag with no path is just bad
 *    news, and bad news with no path is why people book somewhere else.
 *  - A range is shown as a range. Quoting a single number for work that
 *    genuinely varies is how a salon ends up arguing at the till.
 */

const CONFIDENCE_COPY = {
  HIGH: 'We are confident in this estimate.',
  MEDIUM: 'A good estimate — we will confirm it in the chair.',
  LOW: 'A rough estimate. More photos, or a quick look in person, would sharpen it.',
} as const

export interface PlanSummaryProps {
  evaluation: EvaluationResult
  currency?: string
  serviceNames?: Readonly<Record<string, string>>
  className?: string
}

export function PlanSummary({
  evaluation,
  currency = 'GBP',
  serviceNames = {},
  className,
}: PlanSummaryProps) {
  const { price, duration, plan, deposit, requirements } = evaluation
  const money = (cents: number) => formatMoney(cents, currency)

  return (
    <div className={cn('flex flex-col gap-8', className)}>
      <Card featured>
        <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="label-caps mb-1">Estimated price</p>
            <p className="font-display text-display-lg text-ink">
              {price.isRange
                ? `${money(price.lowCents)} – ${money(price.highCents)}`
                : money(price.estimatedTotalCents)}
            </p>
            {price.isRange && (
              <p className="mt-1 max-w-prose text-secondary text-ink-muted">
                A range, because how your hair responds decides the final figure. We will confirm
                before we start.
              </p>
            )}
          </div>

          <div className="sm:text-right">
            <p className="label-caps mb-1">Time in the chair</p>
            <p className="font-display text-display-md text-ink">
              {formatDuration(duration.totalMin)}
            </p>
            <p className="mt-1 text-secondary text-ink-muted">
              {CONFIDENCE_COPY[duration.confidence]}
            </p>
          </div>
        </CardContent>
      </Card>

      {plan.sessions.length > 1 && (
        <section>
          <h2 className="font-display text-display-md text-ink">
            This is {plan.sessions.length} visits, not one
          </h2>
          <p className="mt-2 max-w-prose text-body text-ink-muted">{plan.rationale}</p>

          <ol className="mt-5 flex flex-col gap-3">
            {plan.sessions.map((session) => (
              <li
                key={session.sequence}
                className="flex flex-col gap-2 rounded-lg border border-line bg-canvas p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-4">
                  <span className="tabular flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold-500 bg-gold-100 text-secondary font-medium text-gold-700">
                    {session.sequence}
                  </span>
                  <div>
                    <p className="text-body font-medium text-ink">{session.label}</p>
                    <p className="text-secondary text-ink-muted">
                      {session.serviceIds.map((id) => serviceNames[id] ?? 'Service').join(' + ')}
                      {session.minDaysAfterPrevious
                        ? ` · at least ${formatGap(session.minDaysAfterPrevious)} after the last visit`
                        : ''}
                    </p>
                  </div>
                </div>

                <div className="pl-13 shrink-0 sm:pl-0 sm:text-right">
                  <p className="tabular text-body text-ink">{money(session.estimatedPriceCents)}</p>
                  <p className="tabular text-secondary text-ink-muted">
                    {formatDuration(session.estimatedDurationMin)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {evaluation.flags.length > 0 && (
        <section>
          <h2 className="font-display text-display-md text-ink">Worth knowing first</h2>
          <p className="mt-2 max-w-prose text-body text-ink-muted">
            None of this means no. It means we would rather tell you now than halfway through.
          </p>

          <div className="mt-5 flex flex-col gap-4">
            {[...evaluation.flags].sort(bySeverity).map((flag) => (
              <ClientRiskFlag key={flag.code} flag={flag} />
            ))}
          </div>
        </section>
      )}

      {requirements.length > 0 && (
        <section>
          <h2 className="font-display text-display-md text-ink">Before your appointment</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {requirements.map((requirement, index) => (
              <li
                key={`${requirement.kind}-${index}`}
                className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4"
              >
                <Badge tone={requirement.dueBefore === 'BOOKING' ? 'warn' : 'info'}>
                  {requirement.dueBefore === 'BOOKING' ? 'Before booking' : 'Before this visit'}
                </Badge>
                <p className="flex-1 text-secondary text-ink">{requirement.rationale}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {deposit.amountCents > 0 && (
        <section className="rounded-lg border border-line bg-surface p-5">
          <p className="label-caps mb-1">Deposit</p>
          <p className="text-body text-ink">
            {money(deposit.amountCents)} to secure the booking, taken off your final bill.
          </p>
          <p className="mt-1 max-w-prose text-secondary text-ink-muted">{deposit.rationale}</p>
        </section>
      )}
    </div>
  )
}

/** A flag in the client's words, with the stylist-facing detail left out. */
export function ClientRiskFlag({ flag }: { flag: ResolvedRiskFlag }) {
  return (
    <RiskFlagCard
      severity={flag.severity}
      title={flag.title}
      detail={flag.clientExplanation}
      recommendedPath={flag.recommendedPath}
    />
  )
}

const SEVERITY_ORDER = { BLOCKER: 0, HIGH: 1, CAUTION: 2, INFO: 3 } as const

function bySeverity(a: ResolvedRiskFlag, b: ResolvedRiskFlag): number {
  return (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
}

function formatGap(days: number): string {
  if (days % 7 === 0) {
    const weeks = days / 7
    return `${weeks} week${weeks === 1 ? '' : 's'}`
  }
  return `${days} day${days === 1 ? '' : 's'}`
}
