import Link from 'next/link'
import { pageContextFor } from '@/server/auth/page'
import { ownerDashboard } from '@/server/services/analytics'
import { aiUsage } from '@/server/services/ai'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { SectionHeading, Stat } from '@/components/ui/data'
import { cn } from '@/lib/utils'
import { formatMinutes, formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * The owner's dashboard.
 *
 * Led by quote accuracy, because that is the claim the product is making and
 * the one no other salon software can answer. Everything below it is ordinary
 * reporting that happens to be useful.
 *
 * Where a figure would be noise, the screen says so in words rather than
 * showing a percentage derived from six data points. An owner who staffs a
 * Saturday on the strength of a meaningless number is worse off than one who
 * was told to wait.
 */

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ salon: string }>
  searchParams: Promise<{ days?: string }>
}) {
  const [{ salon }, query] = await Promise.all([params, searchParams])
  const ctx = await pageContextFor(salon, 'report.viewSalon')

  const days = RANGES.find((r) => String(r.days) === query.days)?.days ?? 30
  const [data, ai] = await Promise.all([
    ownerDashboard(ctx.salonId, ctx.timezone, days),
    aiUsage(ctx.salonId),
  ])

  const { accuracy, funnel, utilisation, rules, revenue } = data

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="heading-flourish font-display text-display-lg text-ink">
            How the salon is doing
          </h1>
          <p className="mt-2 text-body text-ink-muted">Last {days} days.</p>
        </div>

        <nav className="flex gap-1">
          {RANGES.map((range) => (
            <Link
              key={range.days}
              href={`/s/${salon}/insights?days=${range.days}`}
              className={cn(
                'rounded-md px-3 py-2 text-secondary transition-colors',
                days === range.days
                  ? 'bg-blue-500 text-ink-inverse shadow-raised'
                  : 'text-ink-muted hover:bg-blue-50 hover:text-blue-700',
              )}
            >
              {range.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* --- The claim ------------------------------------------------------- */}
      <section>
        <SectionHeading
          title="Were the quotes true?"
          description="Measured on chair time, not booked time — booked time expands to fill the slot and would make this number meaningless."
        />

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Estimates that held"
            value={
              accuracy.overall.withinToleranceRate === null
                ? '—'
                : `${Math.round(accuracy.overall.withinToleranceRate * 100)}%`
            }
            hint={
              accuracy.overall.withinToleranceRate === null
                ? `${accuracy.overall.sampleCount} finished — not enough yet`
                : 'within 15 minutes'
            }
          />
          <Stat
            label="Typical miss"
            value={
              accuracy.overall.medianErrorMin === null
                ? '—'
                : formatMinutes(Math.round(accuracy.overall.medianErrorMin))
            }
            hint="median, either direction"
          />
          <Stat
            label="Consistent bias"
            value={
              accuracy.overall.medianBiasMin === null
                ? '—'
                : `${accuracy.overall.medianBiasMin > 0 ? '+' : ''}${Math.round(accuracy.overall.medianBiasMin)}m`
            }
            hint={
              accuracy.overall.medianBiasMin === null
                ? 'not enough data'
                : accuracy.overall.medianBiasMin > 10
                  ? 'You are under-quoting'
                  : accuracy.overall.medianBiasMin < -10
                    ? 'You are over-quoting'
                    : 'Balanced'
            }
          />
          <Stat
            label="Price held"
            value={
              accuracy.priceHeldRate === null ? '—' : `${Math.round(accuracy.priceHeldRate * 100)}%`
            }
            hint="final bill matched the quote"
          />
        </div>

        {accuracy.perStylist.length > 0 && (
          <div className="mt-6">
            <p className="label-caps mb-3">By stylist</p>
            <ul className="flex flex-col divide-y divide-line border-y border-line">
              {accuracy.perStylist.map((row) => (
                <li key={row.stylistId} className="flex items-center justify-between gap-4 py-3">
                  <span className="text-secondary text-ink">{row.name}</span>
                  <div className="flex items-center gap-6">
                    <span className="tabular text-secondary text-ink-subtle">
                      {row.sampleCount} finished
                    </span>
                    <span className="tabular w-20 text-right text-secondary text-ink">
                      {row.withinToleranceRate === null
                        ? 'too few'
                        : `${Math.round(row.withinToleranceRate * 100)}%`}
                    </span>
                    <span
                      className={cn(
                        'tabular w-16 text-right text-secondary',
                        row.medianBiasMin !== null && Math.abs(row.medianBiasMin) > 15
                          ? 'text-warn'
                          : 'text-ink-subtle',
                      )}
                    >
                      {row.medianBiasMin === null
                        ? '—'
                        : `${row.medianBiasMin > 0 ? '+' : ''}${Math.round(row.medianBiasMin)}m`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* --- Where people stop ----------------------------------------------- */}
      <section>
        <SectionHeading
          title="Where consultations stop"
          description={
            funnel.worst
              ? `The biggest single drop is at “${funnel.worst.label}” — ${funnel.worst.droppedHere} people.`
              : 'Nothing has dropped out yet.'
          }
        />

        {funnel.photos.needed > 0 && (
          <p className="mt-3 max-w-prose text-secondary text-ink-muted">
            {funnel.photos.provided} of {funnel.photos.needed} added photos. They are optional for a
            cut, so this is not a step people fail — but a chemical consultation without them is an
            estimate rather than a quote.
          </p>
        )}

        <ul className="mt-5 flex flex-col gap-2">
          {funnel.steps.map((step) => {
            /*
             * A zero-count stage draws nothing. The minimum width is there so
             * a small-but-real number stays visible; applying it to zero draws
             * a bar for people who do not exist.
             */
            const width =
              step.count > 0 && funnel.steps[0]?.count
                ? Math.max(2, (step.count / funnel.steps[0].count) * 100)
                : 0

            return (
              <li key={step.key} className="flex items-center gap-4">
                <span className="w-40 shrink-0 text-secondary text-ink-muted">{step.label}</span>
                <div className="h-8 flex-1 overflow-hidden rounded-md bg-surface-alt">
                  <div
                    className={cn(
                      'h-full',
                      funnel.worst?.key === step.key ? 'bg-warn' : 'bg-blue-500',
                    )}
                    style={{ width: `${width}%` }}
                  />
                </div>
                <span className="tabular w-16 shrink-0 text-right text-secondary text-ink">
                  {step.count}
                </span>
                <span className="tabular w-16 shrink-0 text-right text-label text-ink-subtle">
                  {step.conversionFromPrevious === null
                    ? ''
                    : `${Math.round(step.conversionFromPrevious * 100)}%`}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      {/* --- Money ------------------------------------------------------------ */}
      <section>
        <SectionHeading title="Takings" />
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Taken"
            value={formatMoney(revenue.currentCents, ctx.currency)}
            delta={
              revenue.changeRate === null
                ? undefined
                : `${revenue.changeRate > 0 ? '+' : ''}${Math.round(revenue.changeRate * 100)}%`
            }
            deltaDirection={
              revenue.changeRate === null ? 'flat' : revenue.changeRate >= 0 ? 'up-good' : 'up-bad'
            }
            hint="vs the period before"
          />
          <Stat label="Completed" value={revenue.completed} />
          <Stat
            label="No-shows"
            value={revenue.noShows}
            hint={
              revenue.noShowRate === null
                ? 'not enough data'
                : `${Math.round(revenue.noShowRate * 100)}% of bookings`
            }
          />
          <Stat label="Cancelled" value={revenue.cancelled} />
        </div>
      </section>

      {/* --- Capacity ---------------------------------------------------------- */}
      <section>
        <SectionHeading
          title="Chair time"
          description="Measured against days each stylist actually worked, not calendar days — dividing by the whole range would report everybody as idle. Freed time is what processing handed to another client."
        />

        <ul className="mt-5 flex flex-col divide-y divide-line border-y border-line">
          {utilisation.map((row) => (
            <li key={row.stylistId} className="flex items-center justify-between gap-4 py-3">
              <span className="text-secondary text-ink">{row.name}</span>
              <div className="flex items-center gap-6">
                <span className="tabular text-secondary text-ink-subtle">
                  {row.workedDays} day{row.workedDays === 1 ? '' : 's'}
                </span>
                <span className="tabular text-secondary text-ink-muted">
                  {formatMinutes(row.chairMin)} in the chair
                </span>
                <span
                  className={cn(
                    'tabular w-28 text-right text-secondary',
                    row.freedMin > 0 ? 'text-gold-700' : 'text-ink-subtle',
                  )}
                >
                  {row.freedMin > 0 ? `${formatMinutes(row.freedMin)} freed` : 'none freed'}
                </span>
                <span className="tabular w-14 text-right text-secondary text-ink">
                  {row.utilisation === null ? '—' : `${Math.round(row.utilisation * 100)}%`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* --- Whether the rules earn their place --------------------------------- */}
      {rules.length > 0 && (
        <section>
          <SectionHeading
            title="Which warnings people act on"
            description="A rule overridden most of the time is training your team to click through warnings — which makes every other flag less effective."
          />

          <ul className="mt-5 flex flex-col divide-y divide-line border-y border-line">
            {rules.map((rule) => (
              <li key={rule.code} className="flex items-center justify-between gap-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-secondary text-ink">
                    {rule.code.replace(/_/g, ' ').toLowerCase()}
                  </span>
                  {rule.needsReview && <Badge tone="warn">Worth revisiting</Badge>}
                </div>
                <div className="flex items-center gap-6">
                  <span className="tabular text-secondary text-ink-subtle">fired {rule.fired}</span>
                  <span className="tabular w-24 text-right text-secondary text-ink">
                    {rule.overrideRate === null
                      ? 'too few'
                      : `${Math.round(rule.overrideRate * 100)}% overruled`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- What the model cost ------------------------------------------------ */}
      <section>
        <SectionHeading
          title="AI"
          description="What it cost this month, and how often your team kept what it produced."
        />
        <Card className="mt-5">
          <CardContent className="flex flex-wrap gap-10">
            <Figure label="Calls" value={String(ai.callCount)} />
            <Figure
              label="Cost"
              value={formatMoney(Math.round(ai.costMicros / 10_000), ctx.currency)}
            />
            <Figure
              label="Kept"
              value={
                ai.acceptanceRate === null
                  ? 'Not judged yet'
                  : `${Math.round(ai.acceptanceRate * 100)}%`
              }
              hint={`${ai.accepted} accepted, ${ai.rejected} discarded`}
            />
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="label-caps mb-1">{label}</p>
      <p className="tabular font-display text-display-sm text-ink">{value}</p>
      {hint && <p className="text-label text-ink-subtle">{hint}</p>}
    </div>
  )
}
