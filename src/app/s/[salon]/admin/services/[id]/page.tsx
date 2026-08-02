import Link from 'next/link'
import { authorize, requireContext } from '@/server/auth/context'
import { getService } from '@/server/services/catalog'
import { Button } from '@/components/ui/button'
import { ServiceEditor } from './service-editor'

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
  const ctx = await requireContext(salon)
  authorize(ctx, 'service.manage')

  const service = await getService(ctx.salonId, id)

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/s/${salon}/admin/services`}>← All services</Link>
        </Button>
      </div>

      <header>
        <h1 className="font-display text-display-lg text-ink">{service.name}</h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          A service is a sequence of phases, not a block of minutes. Describing it accurately is
          what lets the diary hand the processing gap to another client.
        </p>
      </header>

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
      />
    </div>
  )
}
