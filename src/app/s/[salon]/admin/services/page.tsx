import Link from 'next/link'
import { pageContextFor } from '@/server/auth/page'
import { listCatalog } from '@/server/services/catalog'
import { interleaveSettings } from '@/server/services/settings'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { chainStats } from '@/domain/scheduling/chain-stats'
import { formatMinutes, formatMoney } from '@/lib/format'
import { ServiceForm } from './service-form'

export const dynamic = 'force-dynamic'

/**
 * The catalog.
 *
 * Deliberately shows the chain shape in the list, not just the price: a salon
 * scanning this page should be able to see at a glance which services are
 * declared as one solid block of stylist time and are therefore quietly costing
 * them a second client every time they are booked.
 */
export default async function ServicesPage({ params }: { params: Promise<{ salon: string }> }) {
  const { salon } = await params
  const ctx = await pageContextFor(salon, 'service.manage')

  const [categories, interleave] = await Promise.all([
    listCatalog(ctx.salonId),
    interleaveSettings(ctx.salonId),
  ])

  if (categories.length === 0) {
    return (
      <EmptyState
        title="No services yet"
        description="Add a category and your first service to start taking bookings."
      />
    )
  }

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="heading-flourish font-display text-display-lg text-ink">Services</h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          What each service is made of decides how it sits in the diary. A service with a real
          processing gap frees the chair for somebody else; one long block does not.
        </p>
      </header>

      {/*
       * The catalogue was read-only from every screen: `saveServiceAction` had
       * no caller, so a salon could restructure a service's phases and still
       * not rename it, reprice it, or take it off online booking.
       */}
      <ServiceForm
        salonSlug={salon}
        categories={categories.map((category) => ({ id: category.id, name: category.name }))}
        service={null}
      />

      {categories.map((category) => (
        <section key={category.id}>
          <h2 className="font-display text-display-md text-ink">{category.name}</h2>

          {category.services.length === 0 ? (
            <p className="mt-3 text-secondary text-ink-subtle">Nothing in this category yet.</p>
          ) : (
            <ul className="mt-4 flex flex-col divide-y divide-line border-y border-line">
              {category.services.map((service) => {
                const stats = chainStats(
                  service.phases.map((phase) => ({
                    kind: phase.kind as 'ACTIVE',
                    label: phase.label,
                    durationMin: phase.durationMin,
                    requiresStylist: phase.requiresStylist,
                    requiresResourceType: null,
                    isScalable: phase.isScalable,
                  })),
                  interleave,
                )

                return (
                  <li key={service.id}>
                    <Link
                      href={`/s/${salon}/admin/services/${service.id}`}
                      className="flex flex-wrap items-center justify-between gap-4 py-4 transition-colors hover:bg-surface-alt"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-body font-medium text-ink">{service.name}</span>
                          {!service.isActive && <Badge tone="neutral">Hidden</Badge>}
                          {service.isLightening && <Badge tone="gold">Lightening</Badge>}
                          {service.requiresConsultation && (
                            <Badge tone="info">Consultation first</Badge>
                          )}
                        </div>
                        <p className="tabular mt-1 text-secondary text-ink-muted">
                          {service.phases.length === 0
                            ? 'No phases set — this cannot be scheduled'
                            : `${formatMinutes(stats.totalMin)} total · ${formatMinutes(stats.stylistMin)} of stylist time`}
                        </p>
                      </div>

                      <div className="flex items-center gap-5">
                        {stats.interleavableMin > 0 && (
                          <span className="tabular text-secondary text-gold-700">
                            {formatMinutes(stats.interleavableMin)} free
                          </span>
                        )}
                        <span className="tabular text-body text-ink">
                          {formatMoney(service.basePriceCents, ctx.currency)}
                        </span>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
