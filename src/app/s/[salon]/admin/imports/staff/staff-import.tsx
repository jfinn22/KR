'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, Select, Textarea } from '@/components/ui/field'
import { commitStaffImportAction, previewStaffImportAction } from '@/server/actions/migration'

interface StaffRow {
  line: number
  displayName: string
  email: string | null
  title: string | null
  skills: string[]
  unknownSkills: string[]
  problems: string[]
}

/**
 * Bringing the team across.
 *
 * Read before written, always. A stylist wrongly credited with
 * COLOR_CORRECTION is one the solver will happily book a corrective on, so
 * anything the file called a skill that this platform does not recognise is
 * shown to the owner rather than guessed at.
 */
export function StaffImport({
  salonSlug,
  locations,
}: {
  salonSlug: string
  locations: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [text, setText] = React.useState('')
  const [rows, setRows] = React.useState<StaffRow[] | null>(null)
  const [existing, setExisting] = React.useState<Record<string, string>>({})
  const [locationId, setLocationId] = React.useState(locations[0]?.id ?? '')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<string | null>(null)

  async function preview() {
    setBusy(true)
    setError(null)
    setDone(null)
    const result = await previewStaffImportAction(salonSlug, { text })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setRows(result.data.rows)
    setExisting(result.data.existing)
  }

  async function commit() {
    if (!rows) return
    setBusy(true)
    setError(null)
    const result = await commitStaffImportAction(salonSlug, { locationId, rows })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDone(
      `${result.data.created} added, ${result.data.updated} updated, ${result.data.skipped} skipped.`,
    )
    setRows(null)
    setText('')
    router.refresh()
  }

  const usable = rows?.filter((row) => row.displayName !== '') ?? []

  return (
    <div className="flex flex-col gap-6">
      {rows === null ? (
        <>
          <Field
            label="Paste the staff list"
            help="A CSV with a name column. Email, job title and skills are used if they are there."
          >
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder="Name,Email,Title,Skills&#10;Wren Ashby,wren@example.com,Senior colourist,Balayage; Colour correction"
            />
          </Field>
          <div>
            <Button onClick={preview} disabled={busy || text.trim() === ''}>
              {busy ? 'Reading…' : 'Read it'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-5">
            <Field label="Which location they work at">
              <Select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-56"
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-secondary text-ink-muted">
              {usable.length} of {rows.length} rows can be brought across.
            </p>
          </div>

          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {rows.map((row) => (
              <li key={row.line} className="flex flex-col gap-1 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body text-ink">
                    {row.displayName || (
                      <span className="text-danger">no name on line {row.line}</span>
                    )}
                  </span>
                  {existing[row.displayName] && <Badge tone="info">already here</Badge>}
                  {row.title && <span className="text-secondary text-ink-muted">{row.title}</span>}
                </div>
                {row.skills.length > 0 && (
                  <p className="text-secondary text-ink-muted">
                    {row.skills.map((s) => s.toLowerCase().replace(/_/g, ' ')).join(', ')}
                  </p>
                )}
                {/*
                 * Named, never guessed at. Crediting somebody with a skill the
                 * file merely hinted at is how a corrective gets booked with
                 * whoever cannot do one.
                 */}
                {row.unknownSkills.length > 0 && (
                  <p className="text-secondary text-warn">
                    Not recognised, so not applied: {row.unknownSkills.join(', ')}
                  </p>
                )}
                {row.problems.length > 0 && (
                  <p className="text-secondary text-danger">{row.problems.join(' · ')}</p>
                )}
              </li>
            ))}
          </ul>

          {error && <p className="text-secondary text-danger">{error}</p>}

          <div className="flex items-center gap-3">
            <Button onClick={commit} disabled={busy || locationId === '' || usable.length === 0}>
              {busy ? 'Bringing them across…' : `Bring ${usable.length} across`}
            </Button>
            <Button variant="ghost" onClick={() => setRows(null)}>
              Start again
            </Button>
          </div>
          <p className="text-secondary text-ink-muted">
            Names and skills only. Nobody gets a login from this — an account nobody can sign into
            sits in the team list forever, and adding one email later is the smaller job.
          </p>
        </>
      )}

      {error && rows === null && <p className="text-secondary text-danger">{error}</p>}
      {done && <p className="text-secondary text-success">{done}</p>}
    </div>
  )
}
