'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { createClientAction } from '@/server/actions/client'

/**
 * Adding somebody at the desk.
 *
 * Collapsed until asked for, because searching is what this screen is mostly
 * for and a form sitting open above the results invites a duplicate every time
 * somebody's name is spelled slightly differently.
 *
 * When it does find an existing match on email or phone it opens that record
 * rather than making a second one, and says so — a salon with three partial
 * histories for the same client has no way to tell which is the real one.
 */
export function NewClient({ salonSlug }: { salonSlug: string }) {
  const router = useRouter()

  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    marketingOptIn: false,
  })
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})

  const set = (patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }))
    setError(null)
  }

  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Add someone new
        </Button>
      </div>
    )
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setFieldErrors({})

    const result = await createClientAction(salonSlug, {
      firstName: form.firstName,
      lastName: form.lastName || null,
      email: form.email || null,
      phone: form.phone || null,
      marketingOptIn: form.marketingOptIn,
    })

    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      if ('fieldErrors' in result && result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }

    router.push(`/s/${salonSlug}/desk/clients/${result.data.id}`)
  }

  const first = (key: string) => fieldErrors[key]?.[0]

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-lg border border-line bg-canvas p-5"
    >
      <div className="flex items-baseline justify-between gap-4">
        <p className="label-caps">Someone new</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-label text-blue-500 underline-offset-2 hover:underline"
        >
          Cancel
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-secondary text-danger"
        >
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="nc-first" required error={first('firstName')}>
          <Input
            id="nc-first"
            required
            value={form.firstName}
            onChange={(e) => set({ firstName: e.target.value })}
          />
        </Field>
        <Field label="Last name" htmlFor="nc-last" error={first('lastName')}>
          <Input
            id="nc-last"
            value={form.lastName}
            onChange={(e) => set({ lastName: e.target.value })}
          />
        </Field>
        <Field
          label="Email"
          htmlFor="nc-email"
          help="Either this or a phone number."
          error={first('email')}
        >
          <Input
            id="nc-email"
            type="email"
            value={form.email}
            onChange={(e) => set({ email: e.target.value })}
          />
        </Field>
        <Field label="Phone" htmlFor="nc-phone" error={first('phone')}>
          <Input
            id="nc-phone"
            type="tel"
            value={form.phone}
            onChange={(e) => set({ phone: e.target.value })}
          />
        </Field>
      </div>

      {/*
       * Off unless they said so out loud. Somebody reading their email address
       * down a phone line has not agreed to receive offers, and the send path
       * now treats an absent marketing consent as "no" — so this checkbox is
       * the only thing that can ever turn it on.
       */}
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={form.marketingOptIn}
          onChange={(e) => set({ marketingOptIn: e.target.checked })}
          className="mt-1 size-4 shrink-0 accent-blue-500"
        />
        <span className="text-secondary text-ink-muted">
          They said yes to offers and news. Appointment reminders go either way.
        </span>
      </label>

      <div>
        <Button type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add them'}
        </Button>
      </div>
    </form>
  )
}
