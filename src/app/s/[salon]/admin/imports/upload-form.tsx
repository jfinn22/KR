'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field, Select } from '@/components/ui/field'
import { startImportAction } from '@/server/actions/migration'

/**
 * The upload.
 *
 * Two questions before the file, and both are asked rather than inferred. Which
 * branch, because a multi-site salon is the one most likely to be switching and
 * a silent wrong guess puts a client's history at the wrong shop. Which
 * platform, because a header row cannot tell you which way round that platform
 * writes its dates.
 *
 * Nothing is written by this screen except the file itself. The next one shows
 * what we made of it, and only then is there a button that changes anything.
 */
export function UploadForm({
  salonSlug,
  locations,
  platforms,
}: {
  salonSlug: string
  locations: { id: string; name: string }[]
  platforms: { value: string; label: string; note: string | null }[]
}) {
  const router = useRouter()
  const [locationId, setLocationId] = React.useState(locations[0]?.id ?? '')
  const [platform, setPlatform] = React.useState('GENERIC')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const note = platforms.find((p) => p.value === platform)?.note ?? null

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = inputRef.current?.files?.[0]
    if (!file) {
      setError('Choose a file first.')
      return
    }

    setBusy(true)
    setError(null)

    /*
     * Read in the browser and post as text. A CSV is text, the server action
     * body limit is generous, and this avoids a second upload endpoint whose
     * authorization would have to be written from scratch — the one thing this
     * codebase has been careful never to have twice.
     */
    const text = await file.text()
    const result = await startImportAction(salonSlug, {
      locationId,
      sourcePlatform: platform,
      filename: file.name,
      text,
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    router.push(`/s/${salonSlug}/admin/imports/${result.data.batchId}`)
  }

  return (
    <form onSubmit={upload} className="flex max-w-xl flex-col gap-5">
      {locations.length > 1 && (
        <Field label="Which of your shops is this history from?">
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field
        label="Where is it coming from?"
        help={note ?? 'Any CSV with a header row will do.'}
      >
        <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {platforms.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="The file" help="A CSV export. Nothing is saved to your salon until you have seen what we made of it.">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="block w-full text-secondary text-ink-muted file:mr-4 file:rounded-md file:border file:border-line file:bg-surface file:px-4 file:py-2 file:font-medium file:text-ink hover:file:bg-surface-muted"
        />
      </Field>

      {error && <p className="text-secondary text-danger">{error}</p>}

      <div>
        <Button type="submit" disabled={busy || !locationId}>
          {busy ? 'Reading…' : 'Read this file'}
        </Button>
      </div>
    </form>
  )
}
