'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { startConsultationAction } from '@/server/actions/consultation'
import { formatDuration, formatMoney } from '@/lib/format'

/**
 * Multi-select service picker.
 *
 * Multi-select because "colour and a cut" is one appointment, and a picker that
 * only takes one service quietly teaches clients to book two — which is how a
 * salon ends up with two half-length slots that do not fit either job.
 *
 * The running total is deliberately labelled "from": the real number comes out
 * of the consultation, and a price shown here that later goes up is exactly the
 * experience this product exists to prevent.
 */

export interface PickableService {
  id: string
  name: string
  description: string | null
  basePriceCents: number
  isChemical: boolean
  requiresConsultation: boolean
  durationMin: number
}

export interface PickableCategory {
  id: string
  name: string
  services: PickableService[]
}

export function ServicePicker({
  salonSlug,
  categories,
  currency,
  preselected = [],
  clientProfileId = null,
  inChair = false,
}: {
  salonSlug: string
  categories: PickableCategory[]
  currency: string
  preselected?: string[]
  /** Set when a stylist is starting this for somebody in their chair. */
  clientProfileId?: string | null
  inChair?: boolean
}) {
  const router = useRouter()
  const all = React.useMemo(() => categories.flatMap((c) => c.services), [categories])

  const [selected, setSelected] = React.useState<string[]>(() =>
    preselected.filter((id) => all.some((service) => service.id === id)),
  )
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const chosen = selected
    .map((id) => all.find((service) => service.id === id))
    .filter((s): s is PickableService => s !== undefined)

  const fromCents = chosen.reduce((sum, service) => sum + service.basePriceCents, 0)
  const roughMin = chosen.reduce((sum, service) => sum + service.durationMin, 0)

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    )

  async function start() {
    setPending(true)
    setError(null)

    const result = await startConsultationAction(salonSlug, {
      serviceIds: selected,
      ...(clientProfileId ? { clientProfileId } : {}),
      ...(inChair ? { inChair: true } : {}),
    })

    if (!result.ok) {
      setError(result.error)
      setPending(false)
      return
    }
    router.push(`/s/${salonSlug}/my/consult/${result.data.consultationId}`)
  }

  return (
    <div className="flex flex-col gap-10">
      {categories.map((category) => (
        <section key={category.id}>
          <h2 className="font-display text-display-md text-ink">{category.name}</h2>

          <div className="mt-4 flex flex-col gap-3">
            {category.services.map((service) => {
              const isSelected = selected.includes(service.id)
              return (
                <button
                  key={service.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggle(service.id)}
                  disabled={pending}
                  className={cn(
                    'flex items-start justify-between gap-5 rounded-lg border border-l-4 p-5 text-left transition-colors',
                    isSelected
                      ? 'border-line border-l-gold-500 bg-gold-100/50'
                      : 'border-line border-l-line bg-canvas hover:bg-surface-alt',
                    pending && 'pointer-events-none opacity-60',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-body font-medium text-ink">{service.name}</span>
                      {service.requiresConsultation && (
                        <Badge tone="gold">Consultation first</Badge>
                      )}
                    </span>
                    {service.description && (
                      <span className="mt-1 block max-w-prose text-secondary text-ink-muted">
                        {service.description}
                      </span>
                    )}
                  </span>

                  <span className="shrink-0 text-right">
                    <span className="tabular block text-body text-ink">
                      from {formatMoney(service.basePriceCents, currency)}
                    </span>
                    {service.durationMin > 0 && (
                      <span className="tabular block text-secondary text-ink-subtle">
                        ~{formatDuration(service.durationMin)}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}

      {/* Sticky, because on a phone the list is long and the action must stay reachable. */}
      <div className="sticky bottom-0 -mx-5 border-t border-line bg-canvas/95 px-5 py-4 backdrop-blur">
        {error && (
          <p role="alert" className="mb-3 text-secondary text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            {chosen.length === 0 ? (
              <p className="text-secondary text-ink-muted">Choose at least one service.</p>
            ) : (
              <>
                <p className="text-body text-ink">
                  {chosen.map((service) => service.name).join(' + ')}
                </p>
                <p className="tabular text-secondary text-ink-muted">
                  from {formatMoney(fromCents, currency)} · roughly {formatDuration(roughMin)}
                </p>
              </>
            )}
          </div>

          <Button onClick={start} disabled={chosen.length === 0 || pending}>
            {pending ? 'Starting…' : 'Continue'}
          </Button>
        </div>
      </div>
    </div>
  )
}
