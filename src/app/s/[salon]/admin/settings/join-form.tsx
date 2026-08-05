'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { generateJoinCode } from '@/lib/join-code'
import { saveJoinCodeAction } from '@/server/actions/settings'

/**
 * How clients get in.
 *
 * Two doors, and the link is the main one — a salon puts it in its Instagram
 * bio, its Google listing and a QR code on the mirror, and somebody arriving
 * through it lands on a page wearing the salon's own colour and logo.
 *
 * The code is for the other case: somebody standing at the till who is not
 * going to be handed a phone. It is optional, because a salon that only shares
 * its link never needs one, and rotatable, because a code read aloud across a
 * counter all day is a code that has leaked.
 */
export function JoinForm({
  salonSlug,
  salonName,
  initialCode,
  appUrl,
}: {
  salonSlug: string
  salonName: string
  initialCode: string | null
  appUrl: string
}) {
  const router = useRouter()
  const [code, setCode] = React.useState(initialCode ?? '')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  const link = `${appUrl}/join/${salonSlug}`
  const dirty = code.trim().toUpperCase() !== (initialCode ?? '')

  async function save(next: string | null) {
    setBusy(true)
    setError(null)
    setStatus(null)

    const result = await saveJoinCodeAction(salonSlug, { joinCode: next })
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    setCode(next ?? '')
    setStatus(next ? 'Saved' : 'Cleared')
    router.refresh()
  }

  return (
    <div className="flex max-w-prose flex-col gap-6">
      <div>
        <p className="label-caps mb-2">Your link</p>
        <div className="flex items-center gap-3">
          <code className="flex-1 overflow-x-auto rounded-lg border border-line bg-surface px-3 py-2.5 text-secondary text-ink">
            {link}
          </code>
          <Button
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard?.writeText(link)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="mt-2 text-secondary text-ink-muted">
          Put this anywhere your clients already look — your Instagram bio, your Google listing, a
          QR code on the mirror. It opens a page wearing {salonName}&rsquo;s own colour.
        </p>
      </div>

      <Field
        label="Join code"
        htmlFor="joinCode"
        help="Optional. For somebody standing at the desk who is not going to type a link. Letters that look alike are left out on purpose."
      >
        <div className="flex items-center gap-3">
          <Input
            id="joinCode"
            value={code}
            spellCheck={false}
            placeholder="Not set"
            onChange={(e) => {
              setCode(e.target.value.toUpperCase())
              setStatus(null)
            }}
          />
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setCode(generateJoinCode(salonName))
              setStatus(null)
            }}
          >
            {initialCode ? 'New code' : 'Generate'}
          </Button>
        </div>
      </Field>

      <div className="flex items-center gap-3">
        <Button onClick={() => save(code.trim() || null)} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {initialCode && (
          <Button variant="secondary" disabled={busy} onClick={() => save(null)}>
            Turn it off
          </Button>
        )}
        <span aria-live="polite" className="text-label text-ink-subtle">
          {error ? null : status}
        </span>
      </div>

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
