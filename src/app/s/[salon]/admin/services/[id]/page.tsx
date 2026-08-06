import Link from 'next/link'
import { pageContextFor } from '@/server/auth/page'
import { getService, listCatalog } from '@/server/services/catalog'
import { Button } from '@/components/ui/button'
import { interleaveSettings } from '@/server/services/settings'
import { ServiceEditor } from './service-editor'
import { ServiceForm } from '../service-form'

export const dynamic = 'force-dynamic'

/**
 * The service editor.
 *
 * The screen where a salon declares what a service actually is, phase by phase.
 * That declaration is what the scheduler places, what the estimate is built
 * from, and what decides whether a processing gap becomes a second booking or
 * dead time.
 */
export default async function ServiceEditorPage({
  params,
}: {
  params: Promise<{ salon: string; id: string }>
}) {
  const { salon, id } = await params
  const ctx = await pageContextFor(salon, 'service.manage')

  const [service, interleave, categories] = await Promise.all([
    getService(ctx.salonId, id),
    interleaveSettings(ctx.salonId),
    listCatalog(ctx.salonId),
  ])

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/s/${salon}/admin/services`}>← All services</Link>
        </Button>
      </div>

      <header>
        <h1 className="heading-flourish font-display text-display-lg text-ink">{service.name}</h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          A service is a sequence of phases, not a block of minutes. Describing it accurately is
          what lets the diary hand the processing gap to another client.
        </p>
      </header>

      {/*
       * What it IS, above what it is made of. A salon coming here to change a
       * price should not have to read the phase editor first — and until now
       * there was nowhere at all to change one.
       */}
      <ServiceForm
        salonSlug={salon}
        categories={categories.map((category) => ({ id: category.id, name: category.name }))}
        service={{
          id: service.id,
          name: service.name,
          slug: service.slug,
          categoryId: service.categoryId,
          description: service.description ?? '',
          basePriceCents: service.basePriceCents,
          baseComplexity: service.baseComplexity,
          isChemical: service.isChemical,
          isLightening: service.isLightening,
          containsDye: service.containsDye,
          isExtensionInstall: service.isExtensionInstall,
          requiresConsultation: service.requiresConsultation,
          requiresPatchTest: service.requiresPatchTest,
          bufferBeforeMin: service.bufferBeforeMin,
          bufferAfterMin: service.bufferAfterMin,
          isBookableOnline: service.isBookableOnline,
          isActive: service.isActive,
        }}
      />

      <ServiceEditor
        salonSlug={salon}
        serviceId={service.id}
        initialPhases={service.phases.map((phase) => ({
          kind: phase.kind as 'ACTIVE',
          label: phase.label,
          durationMin: phase.durationMin,
          requiresStylist: phase.requiresStylist,
          requiresResourceType: phase.requiresResourceType as 'CHAIR' | null,
          isScalable: phase.isScalable,
        }))}
        interleave={interleave}
      />
    </div>
  )
}
