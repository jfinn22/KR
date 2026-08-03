import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  NoAccessError,
  UnauthenticatedError,
  permitted,
  requireContext,
} from '@/server/auth/context'
import type { Action } from '@/domain/authz/actions'

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

  /*
   * Built from permissions rather than from role, so a stylist who cannot
   * manage the catalog simply does not see the link. Hiding a link is not
   * security — every page checks for itself — but a nav full of dead ends is
   * how staff learn to distrust the whole product.
   */
  const nav = isStaff ? STAFF_NAV.filter((item) => permitted(ctx, item.action)) : CLIENT_NAV

  return (
    <div className="app-wash flex min-h-screen flex-col">
      {/* The gilt edge: one hairline of gold across the top of every screen. */}
      <div aria-hidden="true" className="edge-gilt" />

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
            {nav.map((item) => (
              <Link
                key={item.href}
                href={`/s/${salon}${item.href}`}
                className="rounded-md px-3 py-2 font-medium text-ink-muted transition-colors hover:bg-blue-50 hover:text-blue-700"
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

const CLIENT_NAV: { href: string; label: string }[] = [
  { href: '/my', label: 'Home' },
  { href: '/my/appointments', label: 'Appointments' },
  { href: '/my/timeline', label: 'My hair' },
]

const STAFF_NAV: { href: string; label: string; action: Action }[] = [
  { href: '/desk', label: 'Today', action: 'appointment.viewAny' },
  { href: '/desk/calendar', label: 'Diary', action: 'appointment.viewAny' },
  { href: '/review', label: 'Reviews', action: 'consultation.review' },
  { href: '/desk/clients', label: 'Clients', action: 'client.viewAny' },
  { href: '/admin/services', label: 'Services', action: 'service.manage' },
  { href: '/insights', label: 'Insights', action: 'report.viewSalon' },
  { href: '/admin/integrations', label: 'Integrations', action: 'integration.manage' },
]
