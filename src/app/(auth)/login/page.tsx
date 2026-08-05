import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { signIn } from '@/server/auth/config'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/field'

export const metadata = { title: 'Sign in' }

async function login(formData: FormData) {
  'use server'
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const next = String(formData.get('next') ?? '/')

  try {
    await signIn('credentials', { email, password, redirect: false })
  } catch (err) {
    if (err instanceof AuthError) redirect(`/login?error=1&next=${encodeURIComponent(next)}`)
    throw err
  }
  redirect(next)
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const { error, next = '/' } = await searchParams

  // `/s/<slug>/…` is the only shape that names a salon, so that is the only
  // shape a join link can be offered from.
  const joinSalon = /^\/s\/([a-z0-9-]+)(\/|$)/i.exec(next)?.[1] ?? null

  return (
    <main className="app-wash flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="font-display text-display-md text-ink">
            Salon Intelligence
          </Link>
          <p className="mt-2 text-secondary text-ink-muted">
            Sign in to your salon, chair, or client account.
          </p>
        </div>

        <Card>
          <CardContent>
            <form action={login} className="flex flex-col gap-5">
              <input type="hidden" name="next" value={next} />

              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-secondary text-danger"
                >
                  That email and password combination didn&apos;t match. Please try again.
                </p>
              )}

              <Field label="Email" htmlFor="email" required>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@salon.com"
                />
              </Field>

              <Field label="Password" htmlFor="password" required>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={8}
                />
              </Field>

              <Button type="submit" size="lg">
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>

        {/*
         * Points at the salon's own join link rather than a generic /signup,
         * because there is no such thing as signing up to the platform — a
         * client joins one salon. `next` carries the salon through, so the
         * link is right whenever somebody arrived from one.
         */}
        {joinSalon && (
          <p className="mt-6 text-center text-secondary text-ink-muted">
            New here?{' '}
            <Link href={`/join/${joinSalon}`} className="text-blue-500 hover:underline">
              Create an account with this salon
            </Link>
          </p>
        )}
      </div>
    </main>
  )
}
