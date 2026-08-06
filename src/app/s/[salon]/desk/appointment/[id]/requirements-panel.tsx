'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, Select, Textarea } from '@/components/ui/field'
import {
  recordStrandTestAction,
  waiveRequirementAction,
} from '@/server/actions/requirements'

interface Requirement {
  id: string
  kind: string
  rationale: string
  status: string
  waiveReason: string | null
}

const LABEL: Record<string, string> = {
  STRAND_TEST: 'A strand test',
  PATCH_TEST: 'A patch test',
  PHOTO: 'Photographs',
  CONSENT: 'Written consent',
  FORM: 'A form',
  IN_PERSON_CONSULT: 'Seeing them in person',
  DEPOSIT: 'A deposit',
}

/**
 * Answering what the engine asked for, at the chair.
 *
 * Every requirement was written `PENDING` and could never leave it: the three
 * other statuses, and the three `satisfiedBy…` columns, had no writer. So a
 * stylist who did the strand test the rules demanded watched the screen go on
 * demanding it. The only way past was to ignore it, which is the opposite of
 * what a requirement is for.
 */
export function RequirementsPanel({
  salonSlug,
  clientProfileId,
  consultationId,
  requirements,
}: {
  salonSlug: string
  clientProfileId: string
  consultationId: string | null
  requirements: Requirement[]
}) {
  const router = useRouter()
  const [openTest, setOpenTest] = React.useState(false)
  const [waiving, setWaiving] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState('')
  const [decision, setDecision] = React.useState<'PROCEED' | 'MODIFY' | 'ABORT'>('PROCEED')
  const [startLevel, setStartLevel] = React.useState('')
  const [liftLevel, setLiftLevel] = React.useState('')
  const [integrity, setIntegrity] = React.useState<'' | 'POOR' | 'FAIR' | 'GOOD'>('')
  const [notes, setNotes] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const pending = requirements.filter((r) => r.status === 'PENDING')
  const strandPending = pending.some((r) => r.kind === 'STRAND_TEST')

  async function saveTest() {
    setBusy(true)
    setError(null)
    const result = await recordStrandTestAction(salonSlug, {
      clientProfileId,
      consultationId,
      startLevel: startLevel === '' ? null : Number(startLevel),
      liftAchievedLevel: liftLevel === '' ? null : Number(liftLevel),
      integrityAfter: integrity === '' ? null : integrity,
      resultNotes: notes.trim() === '' ? null : notes.trim(),
      decision,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setOpenTest(false)
    router.refresh()
  }

  async function waive(requirementId: string) {
    setBusy(true)
    setError(null)
    const result = await waiveRequirementAction(salonSlug, { requirementId, reason: reason.trim() })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setWaiving(null)
    setReason('')
    router.refresh()
  }

  if (requirements.length === 0) return null

  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {requirements.map((requirement) => (
          <li key={requirement.id} className="flex flex-col gap-2 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body font-medium text-ink">
                {LABEL[requirement.kind] ?? requirement.kind.replace(/_/g, ' ').toLowerCase()}
              </span>
              {requirement.status === 'PENDING' && <Badge tone="warn">Outstanding</Badge>}
              {requirement.status === 'SATISFIED' && <Badge tone="success">Done</Badge>}
              {requirement.status === 'WAIVED' && <Badge tone="neutral">Waived</Badge>}
              {/*
               * A failed requirement is the loudest thing on this screen. It
               * means the test was done and the hair said no.
               */}
              {requirement.status === 'FAILED' && <Badge tone="danger">The test said no</Badge>}
            </div>
            <p className="text-secondary text-ink-muted">{requirement.rationale}</p>
            {requirement.waiveReason && (
              <p className="text-secondary text-ink">Waived: {requirement.waiveReason}</p>
            )}

            {requirement.status === 'PENDING' && (
              <div className="mt-1 flex flex-wrap items-center gap-3">
                {requirement.kind === 'STRAND_TEST' && !openTest && (
                  <Button size="sm" onClick={() => setOpenTest(true)}>
                    Record the strand test
                  </Button>
                )}
                {waiving === requirement.id ? (
                  <div className="flex w-full max-w-lg flex-col gap-2">
                    {/*
                     * The reason is not optional and the guard enforces it —
                     * going ahead without what the rules asked for is a
                     * decision somebody puts their name to.
                     */}
                    <Field label="Why is it safe to go ahead without this?">
                      <Textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                      />
                    </Field>
                    <div className="flex items-center gap-3">
                      <Button
                        size="sm"
                        disabled={busy || reason.trim().length < 8}
                        onClick={() => waive(requirement.id)}
                      >
                        Waive it
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setWaiving(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setWaiving(requirement.id)}>
                    Go ahead without it
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {openTest && strandPending && (
        <div className="flex max-w-2xl flex-col gap-4 rounded-lg border border-line bg-surface p-5">
          <div className="flex flex-wrap gap-5">
            <Field label="Level before">
              <input
                value={startLevel}
                onChange={(e) => setStartLevel(e.target.value.replace(/\D/g, '').slice(0, 2))}
                className="w-16 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
              />
            </Field>
            <Field label="Level it lifted to">
              <input
                value={liftLevel}
                onChange={(e) => setLiftLevel(e.target.value.replace(/\D/g, '').slice(0, 2))}
                className="w-16 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
              />
            </Field>
            <Field label="How it felt after">
              <Select
                value={integrity}
                onChange={(e) => setIntegrity(e.target.value as typeof integrity)}
                className="w-36"
              >
                <option value="">Not recorded</option>
                <option value="GOOD">Good</option>
                <option value="FAIR">Fair</option>
                <option value="POOR">Poor</option>
              </Select>
            </Field>
          </div>

          <Field label="What you found" help="What you would tell the client, in your words.">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>

          <Field label="So">
            <Select
              value={decision}
              onChange={(e) => setDecision(e.target.value as typeof decision)}
              className="max-w-72"
            >
              <option value="PROCEED">Go ahead as planned</option>
              <option value="MODIFY">Go ahead, but change the plan</option>
              <option value="ABORT">Do not do it</option>
            </Select>
          </Field>

          {decision === 'ABORT' && (
            <p className="text-secondary text-danger">
              This marks the requirement failed, not met. The plan needs rethinking with the client
              before anything else happens.
            </p>
          )}

          {error && <p className="text-secondary text-danger">{error}</p>}

          <div className="flex items-center gap-3">
            <Button onClick={saveTest} disabled={busy}>
              {busy ? 'Saving…' : 'Save what it showed'}
            </Button>
            <Button variant="ghost" onClick={() => setOpenTest(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && !openTest && <p className="text-secondary text-danger">{error}</p>}
    </div>
  )
}
