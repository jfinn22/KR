import { pageContextFor } from '@/server/auth/page'
import { platformBillingFor } from '@/server/services/platform-billing'
import { SectionHeading, Stat } from '@/components/ui/data'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { formatDayHeading, localDateIn } from '@/lib/format'
import { PlanPicker } from './plan-picker'

export const dynamic = 'force-dynamic'

/**
 * What the salon pays this platform.
 *
 * Every salon in the database has been `TRIALING` forever, because nothing has
 * ever written the provider columns `Subscription` has carried since the first
 * migration. This is the screen that writes them.
 *
 * It leads with the limits rather than the price, because the thing an owner
 * actually needs to know is whether the tier they are reading still fits the
 * business they have now — a salon that has grown to six stylists should be
 * told that Starter allows one before they choose it, not after.
 */
export default async function PlatformBillingPage({
  params,
}: {
  params: Promise<{ salon: string }>
}) {
  const { salon } = await params
  const ctx = await pageContextFor(salon, 'billing.manage')

  const billing = await platformBillingFor(ctx.salonId)

  if (!billing) {
    return (
      <EmptyState
        title="No subscription on record"
        description="This salon has no subscription row, which should not happen. Somebody at the platform needs to look at it."
      />
    )
  }

  const current = billing.catalogue.find((plan) => plan.code === billing.planCode)

  return (
    <div className="flex flex-col gap-12">
      <header>
        <h1 className="heading-flourish font-display text-display-lg text-ink">Your plan</h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          What this salon pays for the platform itself — separate from the memberships you sell your
          own clients. Changing tier keeps the period you have already paid for and bills only the
          difference for the rest of it.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="On" value={current?.name ?? billing.planCode} />
        <Stat
          label="State"
          value={billing.status.replace('_', ' ').toLowerCase()}
          hint={billing.live ? undefined : 'Nothing has been charged yet'}
        />
        <Stat
          label="Stylists"
          value={billing.usage.stylists}
          hint={current ? `${current.maxStylists} allowed` : undefined}
        />
        <Stat
          label="Locations"
          value={billing.usage.locations}
          hint={current ? `${current.maxLocations} allowed` : undefined}
        />
      </div>

      {billing.currentPeriodEnd && (
        <p className="text-body text-ink-muted">
          {billing.cancelAtPeriodEnd ? 'Runs until' : 'Renews'}{' '}
          {formatDayHeading(localDateIn(ctx.timezone, billing.currentPeriodEnd), ctx.timezone)}
          {billing.status === 'PAST_DUE' && (
            <>
              {' · '}
              {/*
               * Said here, because a salon reading this page after a failed
               * payment is looking for whether they have lost anything. They
               * have not: `requireFeature` reads the plan, not the payment
               * state, and taking a salon's diary away over a card their
               * bookkeeper will fix on Monday would cost them their day.
               */}
              <span className="text-ink">
                A payment did not go through. Nothing has been switched off — sort the card when you
                can.
              </span>
            </>
          )}
        </p>
      )}

      <section>
        <SectionHeading
          title="What there is"
          description="A tier you have outgrown is shown with the numbers, not hidden."
        />
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {billing.catalogue.map((plan) => {
            const isCurrent = plan.code === billing.planCode
            return (
              <div
                key={plan.code}
                className={
                  isCurrent
                    ? 'flex flex-col gap-3 rounded-lg border-l-4 border-l-gold-500 bg-gold-100/50 p-5'
                    : 'flex flex-col gap-3 rounded-lg border border-line bg-surface p-5'
                }
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-display text-display-sm text-ink">{plan.name}</span>
                  {isCurrent && <Badge tone="gold">Yours</Badge>}
                </div>
                <p className="tabular text-body text-ink">
                  {(
                    (billing.yearly ? plan.yearlyPriceCents : plan.monthlyPriceCents) / 100
                  ).toFixed(2)}{' '}
                  <span className="text-ink-muted">/ {billing.yearly ? 'year' : 'month'}</span>
                </p>
                <p className="text-secondary text-ink-muted">{plan.descriptionText}</p>
                <p className="text-label text-ink-subtle">
                  Up to {plan.maxStylists} {plan.maxStylists === 1 ? 'stylist' : 'stylists'},{' '}
                  {plan.maxLocations} {plan.maxLocations === 1 ? 'location' : 'locations'}
                </p>
                {plan.overBy && (
                  <p className="text-secondary text-danger">
                    You are over this one by{' '}
                    {[
                      plan.overBy.stylists > 0
                        ? `${plan.overBy.stylists} ${plan.overBy.stylists === 1 ? 'stylist' : 'stylists'}`
                        : null,
                      plan.overBy.locations > 0
                        ? `${plan.overBy.locations} ${plan.overBy.locations === 1 ? 'location' : 'locations'}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' and ')}
                    .
                  </p>
                )}
                {!plan.priceConfigured && (
                  <p className="text-secondary text-ink-subtle">
                    No price set up for this one yet — that is ours to fix, not yours.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <SectionHeading
          title={billing.live ? 'Move tier' : 'Start paying'}
          description={
            billing.live
              ? 'Takes effect now. You are charged the difference for the days left in this period, not a fresh one.'
              : 'Your trial becomes a subscription. Nothing you have set up changes.'
          }
        />
        <div className="mt-6">
          <PlanPicker
            salonSlug={salon}
            currentCode={billing.planCode}
            live={billing.live}
            yearly={billing.yearly}
            plans={billing.catalogue.map((plan) => ({
              code: plan.code,
              name: plan.name,
              monthlyPriceCents: plan.monthlyPriceCents,
              yearlyPriceCents: plan.yearlyPriceCents,
              blocked: plan.overBy !== null || !plan.priceConfigured,
            }))}
          />
        </div>
      </section>
    </div>
  )
}
