import Link from 'next/link'
import { notFound } from 'next/navigation'
import { brandingForSlug } from '@/server/services/branding'
import { Card, CardContent } from '@/components/ui/card'
import { SignUpForm } from './signup-form'

export const dynamic = 'force-dynamic'

/**
 * Joining a salon.
 *
 * Lives beside `/login` rather than under `/s/[salon]`, and that placement is
 * load-bearing. The salon shell's layout resolves a tenant context and
 * redirects anyone without one to sign in — which is every single person this
 * page exists for. Putting it inside that directory made the join link bounce
 * straight to the login form.
 *
 * Branded, because a client arriving from a salon's Instagram link should land
 * on something that looks like that salon rather than on generic software. That
 * is the reason `brandingForSlug` takes a slug and not a context: there is no
 * context here to take.
 */
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ salon: string }>
  searchParams: Promise<{ code?: string }>
}) {
  const [{ salon }, query] = await Promise.all([params, searchParams])
  const branding = await brandingForSlug(salon)
  if (!branding) notFound()

  return (
    <main
      className="app-wash flex min-h-screen items-center justify-center px-6 py-16"
      style={branding.cssVariables as React.CSSProperties}
    >
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt={branding.salonName}
              className="mx-auto max-h-12 w-auto object-contain"
            />
          ) : (
            <p className="font-display text-display-md text-ink">{branding.salonName}</p>
          )}
          <p className="mt-3 text-secondary text-ink-muted">
            Make an account and we will keep your hair history, your formulas and your next
            appointment in one place.
          </p>
        </div>

        <Card>
          <CardContent>
            <SignUpForm salonSlug={salon} presetCode={query.code ?? null} />
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-secondary text-ink-muted">
          Been here before?{' '}
          <Link
            href={`/login?next=${encodeURIComponent(`/s/${salon}/my`)}`}
            className="text-blue-500 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
