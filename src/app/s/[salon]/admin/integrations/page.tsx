import { pageContextFor } from '@/server/auth/page'
import { listConnections } from '@/server/services/integrations'
import { listStylists } from '@/server/services/team'
import { adapterReport } from '@/ports/registry'
import { Badge } from '@/components/ui/badge'
import { SectionHeading } from '@/components/ui/data'
import { CalendarFeeds } from './calendar-feeds'
import { ConnectionList } from './connection-list'

export const dynamic = 'force-dynamic'

/**
 * Integrations.
 *
 * Led by the calendar feed, because it is the one that actually gets used: a
 * URL a stylist pastes into their phone, no account, nothing that can break.
 * The heavier two-way connections are below it, with their last error visible
 * — a sync that quietly stopped three weeks ago is worse than no sync, and
 * this is the only page anyone would find out on.
 */
export default async function IntegrationsPage({ params }: { params: Promise<{ salon: string }> }) {
  const { salon } = await params
  const ctx = await pageContextFor(salon, 'integration.manage')

  const [connections, stylists] = await Promise.all([
    listConnections(ctx.salonId),
    listStylists(ctx.salonId),
  ])

  const feedByStylist = new Map(
    connections.filter((c) => c.provider === 'APPLE_ICAL' && c.isActive).map((c) => [c.scope, c]),
  )

  const modes = adapterReport()
  const mocked = modes.filter((mode) => mode.mode === 'mock')

  return (
    <div className="flex flex-col gap-12">
      <header>
        <h1 className="heading-flourish font-display text-display-lg text-ink">Integrations</h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          Nothing here can stop a booking. A provider being down delays a calendar entry or a
          message; it never blocks the diary or the till.
        </p>
      </header>

      <section>
        <SectionHeading
          title="Calendar feeds"
          description="A link each stylist adds to their own phone. Read-only, revocable, and it shows initials rather than full client names."
        />
        <div className="mt-5">
          <CalendarFeeds
            salonSlug={salon}
            stylists={stylists.map((stylist) => ({
              id: stylist.id,
              name: stylist.displayName,
              hasFeed: feedByStylist.has(stylist.displayName),
            }))}
          />
        </div>
      </section>

      <section>
        <SectionHeading
          title="Connected accounts"
          description="Two-way sync, where a salon wants external commitments respected by the diary."
        />
        <div className="mt-5">
          <ConnectionList salonSlug={salon} connections={connections} />
        </div>
      </section>

      {mocked.length > 0 && (
        <section className="rounded-lg border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-display-sm text-ink">Running on mocks</h2>
            <Badge tone="gold">Development</Badge>
          </div>
          <p className="mt-2 max-w-prose text-secondary text-ink-muted">
            {mocked.length} of {modes.length} services are using their built-in mock, so the whole
            platform works with no accounts and no keys. Messages appear in the dev outbox rather
            than being sent.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {modes.map((mode) => (
              <li key={mode.port}>
                <Badge tone={mode.mode === 'mock' ? 'neutral' : 'success'}>
                  {mode.port} · {mode.name}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
