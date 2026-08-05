import { pageContext } from '@/server/auth/page'
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
  searchParams: Promise<{ services?: string; client?: string }>
}) {
  const [{ salon }, query] = await Promise.all([params, searchParams])
  const ctx = await pageContext(salon)

  /*
   * A stylist with the client in the chair, on their own device.
   *
   * Two things change. The catalog stops being the online-bookable subset — a
   * service kept off the public page is usually one the salon wants a
   * conversation about first, and this IS that conversation. And the
   * consultation is marked as filled in by somebody looking at the hair, which
   * is a different quality of answer from a client guessing at their own
   * porosity.
   */
  const inChair = ctx.principal.kind === 'staff' && Boolean(query.client)
  const clientProfileId = inChair ? (query.client ?? null) : null

  const categories = await listCatalog(ctx.salonId, { onlineOnly: !inChair })
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
        <h1 className="font-display text-display-lg text-ink">
          {inChair ? 'What are they having?' : 'What are you after?'}
        </h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          {inChair
            ? 'Everything on the menu, not just what is bookable online. You are looking at the hair, so answer what you can see.'
            : 'Pick everything you want in one visit. We will ask a few questions, then tell you what it honestly takes — time, cost, and whether it is one visit or more.'}
        </p>
      </header>

      <ServicePicker
        salonSlug={salon}
        currency={ctx.currency}
        preselected={preselected}
        clientProfileId={clientProfileId}
        inChair={inChair}
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
