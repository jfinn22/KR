'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { PhaseEditor } from '@/components/salon/phase-editor'
import {
  blankPhase,
  type InterleaveSettings,
  type PhaseDraft,
} from '@/domain/scheduling/chain-stats'
import { savePhasesAction } from '@/server/actions/catalog'

/**
 * Editing a service's phase chain.
 *
 * Saves as a whole rather than per-phase: a chain is meaningless in pieces, and
 * a half-applied edit that leaves a stale sequence number would corrupt every
 * future estimate for this service.
 */
export function ServiceEditor({
  salonSlug,
  serviceId,
  initialPhases,
  interleave,
}: {
  salonSlug: string
  serviceId: string
  initialPhases: PhaseDraft[]
  interleave: InterleaveSettings
}) {
  const router = useRouter()

  const [phases, setPhases] = React.useState<PhaseDraft[]>(
    initialPhases.length > 0 ? initialPhases : [blankPhase()],
  )
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const dirty = React.useMemo(
    () => JSON.stringify(phases) !== JSON.stringify(initialPhases),
    [phases, initialPhases],
  )

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)

    const result = await savePhasesAction(salonSlug, {
      serviceId,
      phases: phases.map((phase) => ({
        ...phase,
        // An unnamed phase still needs something a client can read on a
        // confirmation, so fall back to the kind rather than saving an empty.
        label: phase.label.trim() || defaultLabel(phase.kind),
      })),
    })

    if (!result.ok) {
      setError(result.error)
      setSaving(false)
      return
    }

    setSaved(true)
    setSaving(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <PhaseEditor
        interleave={interleave}
        phases={phases}
        onChange={(next) => {
          setPhases(next)
          setSaved(false)
        }}
        disabled={saving}
      />

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-4 border-t border-line bg-canvas/95 py-4 backdrop-blur">
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save the chain'}
        </Button>

        <span aria-live="polite" className="text-secondary text-ink-muted">
          {saved ? 'Saved. New bookings use this from now on.' : dirty ? 'Unsaved changes' : ''}
        </span>
      </div>

      <p className="max-w-prose text-secondary text-ink-subtle">
        Appointments already booked keep the shape they were agreed with — their phase chain was
        frozen when the plan was approved, so this edit cannot change them.
      </p>
    </div>
  )
}

function defaultLabel(kind: PhaseDraft['kind']): string {
  switch (kind) {
    case 'PROCESSING':
      return 'Processing'
    case 'RINSE':
      return 'Rinse'
    case 'CONSULT':
      return 'Consultation'
    default:
      return 'Service'
  }
}
