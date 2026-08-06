'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { submitFormAction } from '@/server/actions/compliance'

interface FormView {
  key: string
  name: string
  version: number
  bodyMarkdown: string
  isLegalPlaceholder: boolean
  signed: {
    signerName: string | null
    signerRelationship: string | null
    signedOn: string
    /** Whether the wording signed is still the wording on file. */
    current: boolean
    signedVersion: number
    currentVersion: number
  } | null
}

/**
 * The forms a salon asks people to sign, and signing one.
 *
 * A signature captured at the desk records who actually signed. A guardian
 * signing for a minor is a different fact from the client signing, and a form
 * that flattens the two is one that proves nothing in the only situation
 * anybody will ever go looking for it.
 *
 * Where the wording has moved on since somebody signed, that is said plainly
 * rather than hidden — a consent against superseded wording is not evidence of
 * consent to the current wording, and the salon needs to know which of its
 * clients it has to ask again.
 */
export function FormsPanel({
  salonSlug,
  clientProfileId,
  forms,
}: {
  salonSlug: string
  clientProfileId: string
  forms: FormView[]
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState<string | null>(null)
  const [signerName, setSignerName] = React.useState('')
  const [relationship, setRelationship] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function sign(formKey: string) {
    setBusy(true)
    setError(null)
    const result = await submitFormAction(salonSlug, {
      formKey,
      clientProfileId,
      signerName: signerName.trim(),
      signerRelationship: relationship.trim() === '' ? null : relationship.trim(),
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setOpen(null)
    setSignerName('')
    setRelationship('')
    router.refresh()
  }

  return (
    <ul className="flex flex-col divide-y divide-line border-y border-line">
      {forms.map((form) => (
        <li key={form.key} className="flex flex-col gap-3 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body text-ink">{form.name}</span>
                {form.signed ? (
                  form.signed.current ? (
                    <Badge tone="success">Signed</Badge>
                  ) : (
                    <Badge tone="warn">Signed an older version</Badge>
                  )
                ) : (
                  <Badge tone="neutral">Not signed</Badge>
                )}
                {/*
                 * Said on the screen, not only in a code comment. A salon
                 * relying on shipped placeholder wording as though a solicitor
                 * had written it is the one failure mode this feature can
                 * actually cause.
                 */}
                {form.isLegalPlaceholder && <Badge tone="danger">Placeholder wording</Badge>}
              </div>

              {form.signed ? (
                <p className="mt-1 text-secondary text-ink-muted">
                  {form.signed.signerName ?? 'Signed'}
                  {form.signed.signerRelationship ? ` (${form.signed.signerRelationship})` : ''} ·{' '}
                  {form.signed.signedOn}
                  {!form.signed.current
                    ? ` · signed v${form.signed.signedVersion}, now on v${form.signed.currentVersion}`
                    : ''}
                </p>
              ) : (
                <p className="mt-1 text-secondary text-ink-muted">Nothing on file for this client.</p>
              )}
            </div>

            {open !== form.key && (
              <Button
                size="sm"
                variant={form.signed?.current ? 'ghost' : 'secondary'}
                onClick={() => {
                  setOpen(form.key)
                  setSignerName('')
                  setRelationship('')
                  setError(null)
                }}
              >
                {form.signed ? 'Sign again' : 'Sign at the desk'}
              </Button>
            )}
          </div>

          {open === form.key && (
            <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface-alt p-5">
              <div className="max-h-56 overflow-y-auto whitespace-pre-line rounded-lg border border-line bg-surface p-4 text-secondary text-ink-muted">
                {form.bodyMarkdown}
              </div>

              <Field
                label="Signed by"
                htmlFor={`signer-${form.key}`}
                help="The name of whoever is actually signing, typed by them."
              >
                <Input
                  id={`signer-${form.key}`}
                  className="max-w-72"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  autoComplete="off"
                />
              </Field>

              <Field
                label="If not the client themselves"
                htmlFor={`relationship-${form.key}`}
                help="Parent, guardian, carer. Leave empty when the client signs for themselves."
              >
                <Input
                  id={`relationship-${form.key}`}
                  className="max-w-72"
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  placeholder="Parent"
                  autoComplete="off"
                />
              </Field>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  onClick={() => sign(form.key)}
                  disabled={busy || signerName.trim().length < 2}
                >
                  {busy ? 'Recording…' : 'Record the signature'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(null)} disabled={busy}>
                  Cancel
                </Button>
              </div>

              {error && (
                <p role="alert" className="text-secondary text-danger">
                  {error}
                </p>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
