'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Label, Select } from '@/components/ui/field'
import {
  applyKindDefaults,
  blankPhase,
  chainStats,
  releasesStylist,
  type ChainStats,
  type InterleaveSettings,
  type PhaseDraft,
  type PhaseKind,
  type ResourceType,
} from '@/domain/scheduling/chain-stats'
import { formatMinutes } from '@/lib/format'

/**
 * The phase editor.
 *
 * This is the screen the whole scheduler rests on. A salon that describes
 * balayage as "175 minutes" gets a calendar that blocks a stylist for nearly
 * three hours. A salon that describes it as 90 active / 40 processing / 45
 * active gets a calendar that hands those 40 minutes to somebody else — the
 * same stylist, the same day, one more client.
 *
 * So the editor shows the consequence continuously: total length, how much of
 * it actually holds the stylist, and which gaps are long enough to interleave.
 */

const KIND_COPY: Record<PhaseKind, { label: string; hint: string }> = {
  ACTIVE: { label: 'Active work', hint: 'Stylist is hands-on' },
  PROCESSING: { label: 'Processing', hint: 'Colour developing — stylist free' },
  RINSE: { label: 'Rinse / basin', hint: 'At the basin' },
  CONSULT: { label: 'Consultation', hint: 'Talking it through' },
}

const RESOURCES: { value: ResourceType | ''; label: string }[] = [
  { value: '', label: 'None needed' },
  { value: 'CHAIR', label: 'Chair' },
  { value: 'BASIN', label: 'Basin' },
  { value: 'PROCESSING_SEAT', label: 'Processing seat' },
  { value: 'ROOM', label: 'Private room' },
  { value: 'DRYER', label: 'Dryer' },
]

export interface PhaseEditorProps {
  phases: readonly PhaseDraft[]
  onChange: (phases: PhaseDraft[]) => void
  /** The salon's own interleaving policy, so the readout matches the solver. */
  interleave: InterleaveSettings
  disabled?: boolean
}

export function PhaseEditor({ phases, onChange, interleave, disabled }: PhaseEditorProps) {
  const stats = chainStats(phases, interleave)

  const update = (index: number, patch: Partial<PhaseDraft>) => {
    onChange(phases.map((phase, i) => (i === index ? applyKindDefaults(phase, patch) : phase)))
  }

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= phases.length) return
    const next = [...phases]
    const [moved] = next.splice(index, 1)
    if (moved) next.splice(target, 0, moved)
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-3">
        {phases.map((phase, index) => (
          <li
            key={index}
            className={cn(
              'rounded-lg border border-l-4 bg-canvas p-4',
              phase.requiresStylist
                ? 'border-line border-l-blue-500'
                : 'border-line border-l-gold-500',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="tabular flex h-7 w-7 items-center justify-center rounded-full bg-surface-alt text-label text-ink-muted">
                  {index + 1}
                </span>
                <Badge tone={phase.requiresStylist ? 'info' : 'gold'}>
                  {phase.requiresStylist ? 'Holds the stylist' : 'Stylist free'}
                </Badge>
              </div>

              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Move ${phase.label || 'phase'} earlier`}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled || index === phases.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move ${phase.label || 'phase'} later`}
                >
                  ↓
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled || phases.length === 1}
                  onClick={() => onChange(phases.filter((_, i) => i !== index))}
                  aria-label={`Remove ${phase.label || 'phase'}`}
                >
                  Remove
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`kind-${index}`}>Kind</Label>
                <Select
                  id={`kind-${index}`}
                  value={phase.kind}
                  disabled={disabled}
                  onChange={(e) => update(index, { kind: e.target.value as PhaseKind })}
                >
                  {(Object.keys(KIND_COPY) as PhaseKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_COPY[kind].label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`label-${index}`}>Shown as</Label>
                <Input
                  id={`label-${index}`}
                  value={phase.label}
                  disabled={disabled}
                  placeholder={KIND_COPY[phase.kind].label}
                  onChange={(e) => update(index, { label: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`duration-${index}`}>Minutes</Label>
                <Input
                  id={`duration-${index}`}
                  type="number"
                  min={5}
                  step={5}
                  inputMode="numeric"
                  value={phase.durationMin}
                  disabled={disabled}
                  onChange={(e) => update(index, { durationMin: Number(e.target.value) || 0 })}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`resource-${index}`}>Needs</Label>
                <Select
                  id={`resource-${index}`}
                  value={phase.requiresResourceType ?? ''}
                  disabled={disabled}
                  onChange={(e) =>
                    update(index, {
                      requiresResourceType: (e.target.value || null) as ResourceType | null,
                    })
                  }
                >
                  {RESOURCES.map((resource) => (
                    <option key={resource.value} value={resource.value}>
                      {resource.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-5">
              <Toggle
                id={`stylist-${index}`}
                label="Stylist must be present"
                help="Uncheck for processing — this is what frees the chair for someone else."
                checked={phase.requiresStylist}
                disabled={disabled}
                onChange={(checked) => update(index, { requiresStylist: checked })}
              />
              <Toggle
                id={`scalable-${index}`}
                label="Scales with hair length"
                help="Long or thick hair stretches this phase, not the processing time."
                checked={phase.isScalable}
                disabled={disabled || phase.kind === 'PROCESSING'}
                onChange={(checked) => update(index, { isScalable: checked })}
              />
            </div>
          </li>
        ))}
      </ol>

      <div>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => onChange([...phases, blankPhase()])}
        >
          Add a phase
        </Button>
      </div>

      <ChainReadout phases={phases} stats={stats} interleave={interleave} />
    </div>
  )
}

/**
 * The consequence, restated in the salon's own terms.
 *
 * Without this the editor is a form. With it, a salon can see that splitting
 * out the processing gap is what turns one client per morning into two.
 */
function ChainReadout({
  phases,
  stats,
  interleave,
}: {
  phases: readonly PhaseDraft[]
  stats: ChainStats
  interleave: InterleaveSettings
}) {
  // Processing time the salon has described but the calendar will not sell,
  // because interleaving is switched off or the gap is under the minimum.
  const withheldMin = phases.reduce(
    (sum, phase) =>
      !phase.requiresStylist && !releasesStylist(phase, interleave)
        ? sum + Math.max(0, phase.durationMin)
        : sum,
    0,
  )

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <Figure label="Total appointment" value={formatMinutes(stats.totalMin)} />
        <Figure label="Stylist is held" value={formatMinutes(stats.stylistMin)} />
        <Figure
          label="Free to hand on"
          value={formatMinutes(stats.interleavableMin)}
          tone={stats.interleavableMin > 0 ? 'gold' : 'muted'}
        />
      </div>

      {phases.length > 0 && (
        <div className="mt-5">
          <div className="flex h-3 w-full overflow-hidden rounded-pill border border-line bg-canvas">
            {phases.map((phase, index) => (
              <span
                key={index}
                title={`${phase.label || KIND_COPY[phase.kind].label} — ${phase.durationMin} min`}
                className={cn(
                  releasesStylist(phase, interleave) ? 'bg-gold-300' : 'bg-blue-500',
                  index > 0 && 'border-l border-canvas',
                )}
                style={{
                  width: `${stats.totalMin > 0 ? (phase.durationMin / stats.totalMin) * 100 : 0}%`,
                }}
              />
            ))}
          </div>
          <p className="mt-2 text-secondary text-ink-muted">
            Blue holds the stylist. Gold is time another client could use.
          </p>
        </div>
      )}

      {/*
       * This copy has to describe what the CALENDAR will do, not what the
       * phases say. It used to promise a gold gap from the phase split alone,
       * while the solver quietly re-blocked it — so a salon with interleaving
       * switched off was told it had capacity it could never sell.
       */}
      <p className="mt-4 max-w-prose text-secondary text-ink">
        {stats.interleavableMin > 0
          ? `A ${formatMinutes(stats.interleavableMin)} gap is long enough to start someone else — this service pays for itself twice over on a busy day.`
          : stats.totalMin === 0
            ? 'Add a phase to see how this service will sit in the calendar.'
            : withheldMin > 0 && !interleave.interleaveEnabled
              ? `You have described ${formatMinutes(withheldMin)} of processing, but interleaving is switched off for this salon — so the calendar still holds the stylist for all of it. Turn it on in settings to sell that time.`
              : withheldMin > 0
                ? `The ${formatMinutes(withheldMin)} of processing here is under this salon's ${formatMinutes(interleave.minInterleaveMin)} minimum, so the calendar keeps the stylist on it. A shorter gap costs more to hand over than it returns.`
                : 'Every minute of this service holds the stylist. If any of it is really waiting time, split it out as a processing phase.'}
      </p>
    </section>
  )
}

function Figure({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'gold' | 'muted'
}) {
  return (
    <div>
      <p className="label-caps mb-1">{label}</p>
      <p
        className={cn(
          'tabular font-display text-display-sm',
          tone === 'gold' ? 'text-gold-700' : tone === 'muted' ? 'text-ink-subtle' : 'text-ink',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function Toggle({
  id,
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  help?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      htmlFor={id}
      className={cn('flex max-w-xs items-start gap-2.5', disabled && 'opacity-45')}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong accent-blue-900"
      />
      <span>
        <span className="block text-secondary text-ink">{label}</span>
        {help && <span className="mt-0.5 block text-label text-ink-subtle">{help}</span>}
      </span>
    </label>
  )
}
