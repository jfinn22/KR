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

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-6 py-16">
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

        <p className="mt-6 text-center text-secondary text-ink-muted">
          New salon?{' '}
          <Link href="/signup" className="text-blue-500 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  )
}
