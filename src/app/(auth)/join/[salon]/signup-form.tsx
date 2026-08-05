'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { signUpClientAction } from '@/server/actions/signup'

/**
 * The join form.
 *
 * On success it sends them to sign in rather than logging them in directly.
 * That is not laziness: signup and claiming an existing walk-in record look
 * identical from here on purpose, and the second case must not hand a session
 * to whoever typed the email. Signing in once proves the address is theirs.
 */
export function SignUpForm({
  salonSlug,
  presetCode,
}: {
  salonSlug: string
  presetCode: string | null
}) {
  const router = useRouter()

  const [form, setForm] = React.useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    joinCode: presetCode ?? '',
    marketingOptIn: false,
  })
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})

  const set = (patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }))
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setFieldErrors({})

    const result = await signUpClientAction(salonSlug, {
      email: form.email,
      password: form.password,
      firstName: form.firstName,
      lastName: form.lastName || null,
      phone: form.phone || null,
      marketingOptIn: form.marketingOptIn,
      joinCode: form.joinCode || null,
    })

    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      if ('fieldErrors' in result && result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }

    router.push(`/login?next=${encodeURIComponent(`/s/${salonSlug}/my`)}&joined=1`)
  }

  const first = (key: string) => fieldErrors[key]?.[0]

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-secondary text-danger"
        >
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="firstName" required error={first('firstName')}>
          <Input
            id="firstName"
            autoComplete="given-name"
            required
            value={form.firstName}
            onChange={(e) => set({ firstName: e.target.value })}
          />
        </Field>
        <Field label="Last name" htmlFor="lastName" error={first('lastName')}>
          <Input
            id="lastName"
            autoComplete="family-name"
            value={form.lastName}
            onChange={(e) => set({ lastName: e.target.value })}
          />
        </Field>
      </div>

      <Field label="Email" htmlFor="email" required error={first('email')}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={(e) => set({ email: e.target.value })}
        />
      </Field>

      <Field
        label="Mobile"
        htmlFor="phone"
        help="Only used for appointment reminders."
        error={first('phone')}
      >
        <Input
          id="phone"
          type="tel"
          autoComplete="tel"
          value={form.phone}
          onChange={(e) => set({ phone: e.target.value })}
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        required
        help="At least 10 characters."
        error={first('password')}
      >
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={form.password}
          onChange={(e) => set({ password: e.target.value })}
        />
      </Field>

      {presetCode === null && (
        <Field
          label="Join code"
          htmlFor="joinCode"
          help="Only if the salon gave you one."
          error={first('joinCode')}
        >
          <Input
            id="joinCode"
            value={form.joinCode}
            spellCheck={false}
            onChange={(e) => set({ joinCode: e.target.value })}
          />
        </Field>
      )}

      {/*
       * Unticked by default and never pre-ticked. Appointment reminders are
       * part of the service and are not asked about here; this is only about
       * offers, which is a different question and has to be answered on
       * purpose.
       */}
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={form.marketingOptIn}
          onChange={(e) => set({ marketingOptIn: e.target.checked })}
          className="mt-1 size-4 shrink-0 accent-blue-500"
        />
        <span className="text-secondary text-ink-muted">
          Send me occasional offers and news. Appointment reminders come either way.
        </span>
      </label>

      <Button type="submit" size="lg" disabled={busy}>
        {busy ? 'Creating your account…' : 'Create my account'}
      </Button>
    </form>
  )
}
