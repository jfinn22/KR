import { notFound } from 'next/navigation'
import { checkInByToken } from '@/server/services/check-in'
import { brandingForSlug } from '@/server/services/branding'
import { CheckInForm } from './check-in-form'

export const dynamic = 'force-dynamic'

/**
 * "How is it sitting?"
 *
 * No account, no session, no salon in the URL — one link from a text message,
 * three days after the appointment. Anything more than that and the client does
 * not answer, and the salon finds out in six weeks from somebody else.
 *
 * This page reads and renders. It does not mutate, and that is not an
 * accident: link previewers, email security scanners and message-app unfurlers
 * all issue a GET at any URL they can see. A check-in that consumed itself on
 * page load would be answered by a robot before the client ever opened it, and
 * the client would then tap through to "thanks, you already told us".
 */
export default async function CheckInPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const view = await checkInByToken(token)
  if (!view) notFound()

  const branding = await brandingForSlug(view.salonSlug)
  const brandStyle = (branding?.cssVariables ?? {}) as React.CSSProperties

  return (
    <div className="app-wash min-h-screen" style={brandStyle}>
      <div aria-hidden="true" className="edge-gilt" />

      <main className="mx-auto flex w-full max-w-lg flex-col gap-8 px-5 py-16">
        <header>
          {branding?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt={view.salonName} className="max-h-10 w-auto" />
          ) : (
            <p className="font-display text-display-sm text-ink">{view.salonName}</p>
          )}
          <h1 className="heading-flourish mt-6 font-display text-display-lg text-ink">
            Hi {view.clientFirstName} — how is it sitting?
          </h1>
          <p className="mt-3 text-body text-ink-muted">
            {view.stylistName
              ? `You were in with ${view.stylistName} a few days ago.`
              : 'You were in with us a few days ago.'}{' '}
            One tap is all this needs.
          </p>
        </header>

        {view.respondedAt ? (
          <div className="rounded-lg border border-line bg-surface px-6 py-8 text-center">
            <p className="font-display text-display-sm text-ink">You already told us.</p>
            <p className="mt-2 text-body text-ink-muted">
              {view.sentiment === 'NOT_RIGHT'
                ? 'Somebody will be in touch — and if it is urgent, call us.'
                : 'Thank you. If anything changes, call us.'}
            </p>
          </div>
        ) : view.expired ? (
          <div className="rounded-lg border border-line bg-surface px-6 py-8 text-center">
            <p className="font-display text-display-sm text-ink">This link has expired.</p>
            <p className="mt-2 text-body text-ink-muted">
              If something is not right, call us — nothing is ever too late to put right.
            </p>
          </div>
        ) : (
          <CheckInForm salonSlug={view.salonSlug} token={token} />
        )}

        <p className="text-label text-ink-subtle">
          We ask because it is easier to fix now than in six weeks.
        </p>
      </main>
    </div>
  )
}
