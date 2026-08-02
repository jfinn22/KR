import { pageContext } from '@/server/auth/page'
import { hairTimeline } from '@/server/services/client-portal'
import { HairTimeline } from '@/components/salon/hair-timeline'
import { EmptyState } from '@/components/ui/feedback'

export const dynamic = 'force-dynamic'

/**
 * The client's hair history.
 *
 * The thing a paper record card never gave anybody: every chemical event in
 * order, with what was used and how it went. It is also the honest answer to
 * "why can't I go platinum this Saturday" — the reason is on the page.
 */
export default async function TimelinePage({ params }: { params: Promise<{ salon: string }> }) {
  const { salon } = await params
  const ctx = await pageContext(salon)

  if (ctx.principal.kind !== 'client') {
    return (
      <EmptyState
        title="This is the client view"
        description="Client histories live in the client record inside the salon workspace."
      />
    )
  }

  const entries = await hairTimeline(ctx.salonId, ctx.principal.clientProfileId)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header>
        <h1 className="font-display text-display-lg text-ink">Your hair</h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          Everything we have done, in order. Your colourist reads this before every appointment — it
          is why you do not have to remember what was used last time.
        </p>
      </header>

      <HairTimeline entries={entries} />
    </div>
  )
}
