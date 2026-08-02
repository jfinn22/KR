import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NoAccessError, UnauthenticatedError, requireContext } from '@/server/auth/context'

/**
 * Salon shell.
 *
 * Every route under `/s/[salon]` resolves its tenant here, once. A page that
 * forgot to check would still be inside a layout that did — and an
 * unauthenticated visitor is sent to sign in with a return path rather than
 * shown an error they cannot act on.
 */

export default async function SalonLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ salon: string }>
}) {
  const { salon } = await params

  let ctx
  try {
    ctx = await requireContext(salon)
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      redirect(`/login?next=${encodeURIComponent(`/s/${salon}/my`)}`)
    }
    if (err instanceof NoAccessError) notFound()
    throw err
  }

  const isStaff = ctx.principal.kind === 'staff'

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="border-b border-line bg-canvas">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-5">
          <Link href={`/s/${salon}/my`} className="flex items-baseline gap-2.5">
            <span className="font-display text-display-sm text-ink">{ctx.salonName}</span>
            <span aria-hidden="true" className="h-4 w-px bg-gold-500" />
            <span className="label-caps hidden sm:inline">
              {isStaff ? 'Salon' : 'Your account'}
            </span>
          </Link>

          <nav className="flex items-center gap-1 text-secondary">
            {(isStaff ? STAFF_NAV : CLIENT_NAV).map((item) => (
              <Link
                key={item.href}
                href={`/s/${salon}${item.href}`}
                className="rounded-md px-3 py-2 text-ink-muted transition-colors hover:bg-surface-alt hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10">{children}</main>

      <footer className="border-t border-line bg-canvas">
        <div className="mx-auto w-full max-w-6xl px-5 py-6">
          <p className="text-label text-ink-subtle">
            {ctx.salonName} · times shown in {ctx.timezone.replace('_', ' ')}
          </p>
        </div>
      </footer>
    </div>
  )
}

const CLIENT_NAV = [
  { href: '/my', label: 'Home' },
  { href: '/my/appointments', label: 'Appointments' },
  { href: '/my/timeline', label: 'My hair' },
]

const STAFF_NAV = [
  { href: '/my', label: 'Home' },
  { href: '/admin/services', label: 'Services' },
]
