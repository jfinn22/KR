import Link from 'next/link'
import { pageContextFor } from '@/server/auth/page'
import { auditActions, auditTrail } from '@/server/services/audit-trail'
import { SectionHeading, Table, TableWrap, Td, Th, Tr } from '@/components/ui/data'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { formatDayHeading, formatTime, localDateIn } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * What was done here, and who did it.
 *
 * `AuditLog` had three writers and no reader: every mutation through
 * `withAuthz` has been landing a row since the platform was built, including
 * the written reason where the policy demanded one, and nothing in the product
 * could show any of it. `audit.view` was granted to owners and managers and
 * gated nothing, because there was nothing to gate.
 *
 * Defaults to the entries that carry a reason. Those are the ones somebody had
 * to justify at the time — an overridden blocker, a discount past the cap, a
 * waived requirement — and they are what anybody comes to this screen looking
 * for. Everything else is one link away.
 */
export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ salon: string }>
  searchParams: Promise<{ action?: string; all?: string; days?: string }>
}) {
  const [{ salon }, query] = await Promise.all([params, searchParams])
  const ctx = await pageContextFor(salon, 'audit.view')

  const days = [7, 30, 90].includes(Number(query.days)) ? Number(query.days) : 30
  const reasonedOnly = query.all !== '1'

  const [entries, actions] = await Promise.all([
    auditTrail(ctx.salonId, { action: query.action ?? null, reasonedOnly, days }),
    auditActions(ctx.salonId, days),
  ])

  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams()
    const merged = { action: query.action, all: query.all, days: String(days), ...patch }
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value)
    return `/s/${salon}/admin/audit${next.toString() ? `?${next}` : ''}`
  }

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="heading-flourish font-display text-display-lg text-ink">What was done</h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          Every change anybody made, with the reason they gave for it. This is the record you read
          back when there is a disagreement about what happened — so it cannot be edited from here,
          or anywhere.
        </p>
      </header>

      <section>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={link({ all: reasonedOnly ? '1' : undefined })}
            className="rounded-md border border-line px-3 py-1.5 text-secondary text-ink hover:bg-surface-alt"
          >
            {reasonedOnly ? 'Show everything' : 'Only what needed a reason'}
          </Link>
          {[7, 30, 90].map((d) => (
            <Link
              key={d}
              href={link({ days: String(d) })}
              className={
                d === days
                  ? 'rounded-md border border-line bg-surface-alt px-3 py-1.5 text-secondary text-ink'
                  : 'rounded-md border border-line px-3 py-1.5 text-secondary text-ink-muted hover:bg-surface-alt'
              }
            >
              {d} days
            </Link>
          ))}
          {query.action && (
            <Link
              href={link({ action: undefined })}
              className="rounded-md border border-line px-3 py-1.5 text-secondary text-ink-muted hover:bg-surface-alt"
            >
              Clear “{query.action}”
            </Link>
          )}
        </div>

        {actions.length > 0 && !query.action && (
          <div className="mt-4 flex flex-wrap gap-2">
            {actions.slice(0, 14).map((row) => (
              <Link
                key={row.action}
                href={link({ action: row.action })}
                className="tabular rounded-md bg-surface px-2.5 py-1 text-label text-ink-muted hover:text-ink"
              >
                {row.action} · {row.count}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeading
          title={reasonedOnly ? 'Things somebody had to justify' : 'Everything'}
          description={`The last ${days} days.`}
        />
        <div className="mt-6">
          {entries.length === 0 ? (
            <EmptyState
              title="Nothing on record"
              description={
                reasonedOnly
                  ? 'Nobody has had to override or explain anything in this window.'
                  : 'No changes were made in this window.'
              }
            />
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Who</Th>
                    <Th>What</Th>
                    <Th>To</Th>
                    <Th>Why</Th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <Tr key={entry.id}>
                      <Td className="tabular whitespace-nowrap">
                        {formatDayHeading(localDateIn(ctx.timezone, entry.at), ctx.timezone)}
                        <span className="ml-2 text-ink-subtle">
                          {formatTime(entry.at.toISOString(), ctx.timezone)}
                        </span>
                      </Td>
                      <Td>
                        {entry.actorName ?? (
                          /*
                           * A row with no user is the platform acting on its own
                           * — a sweep, a webhook, a job. Saying so is better
                           * than an empty cell that reads as missing data.
                           */
                          <span className="text-ink-subtle">
                            {entry.actorType === 'SYSTEM' ? 'the system' : 'unknown'}
                          </span>
                        )}
                        {entry.actorRole && (
                          <span className="ml-2 text-label text-ink-subtle">
                            {entry.actorRole.toLowerCase().replace(/_/g, ' ')}
                          </span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">{entry.action}</Td>
                      <Td className="text-ink-muted">{entry.entityType}</Td>
                      <Td>
                        {entry.reason ? (
                          <span className="text-ink">{entry.reason}</span>
                        ) : (
                          <Badge tone="neutral">routine</Badge>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </div>
      </section>
    </div>
  )
}
