import { requireContext } from '@/server/auth/context'
import { listCatalog } from '@/server/services/catalog'
import { EmptyState } from '@/components/ui/feedback'
import { ServicePicker } from './service-picker'

export const dynamic = 'force-dynamic'

/**
 * Choosing what you want.
 *
 * Online-bookable services only: a salon that has marked something
 * consultation-only means it, and offering it here would produce a client who
 * thinks they have booked something they have not.
 */
export default async function NewConsultationPage({
  params,
  searchParams,
}: {
  params: Promise<{ salon: string }>
  searchParams: Promise<{ services?: string }>
}) {
  const [{ salon }, query] = await Promise.all([params, searchParams])
  const ctx = await requireContext(salon)

  const categories = await listCatalog(ctx.salonId, { onlineOnly: true })
  const withServices = categories.filter((category) => category.services.length > 0)

  if (withServices.length === 0) {
    return (
      <EmptyState
        title="Nothing bookable online just yet"
        description="Give the salon a call and they will sort you out."
      />
    )
  }

  const preselected = (query.services ?? '').split(',').filter(Boolean)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header>
        <h1 className="font-display text-display-lg text-ink">What are you after?</h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          Pick everything you want in one visit. We will ask a few questions, then tell you what it
          honestly takes — time, cost, and whether it is one visit or more.
        </p>
      </header>

      <ServicePicker
        salonSlug={salon}
        currency={ctx.currency}
        preselected={preselected}
        categories={withServices.map((category) => ({
          id: category.id,
          name: category.name,
          services: category.services.map((service) => ({
            id: service.id,
            name: service.name,
            description: service.description,
            basePriceCents: service.basePriceCents,
            isChemical: service.isChemical,
            requiresConsultation: service.requiresConsultation,
            durationMin: service.phases.reduce((sum, phase) => sum + phase.durationMin, 0),
          })),
        }))}
      />
    </div>
  )
}
