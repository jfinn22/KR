import Link from 'next/link'
import { pageContextFor } from '@/server/auth/page'
import { findClients } from '@/server/services/front-desk'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { NewClient } from './new-client'
import { Input, Label } from '@/components/ui/field'

export const dynamic = 'force-dynamic'

/**
 * Finding a client at the desk.
 *
 * One box, because whoever is standing there gave a name, an email or a phone
 * number and the receptionist should not have to pick a field first. A GET form
 * rather than a live search: the result is linkable, survives a reload, and
 * works when the desk's connection is bad — which is exactly when somebody is
 * standing there waiting.
 */
export default async function ClientSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ salon: string }>
  searchParams: Promise<{ q?: string }>
}) {
  const [{ salon }, query] = await Promise.all([params, searchParams])
  const ctx = await pageContextFor(salon, 'client.viewAny')

  const term = (query.q ?? '').trim()
  const results = term.length >= 2 ? await findClients(ctx.salonId, term) : []

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header>
        <h1 className="heading-flourish font-display text-display-lg text-ink">Find a client</h1>
        <p className="mt-2 text-body text-ink-muted">
          Name, email or phone — whichever they gave you.
        </p>
      </header>

      <form action={`/s/${salon}/desk/clients`} method="get" className="flex items-end gap-3">
        <div className="flex-1">
          <Label htmlFor="q">Search</Label>
          <Input
            id="q"
            name="q"
            defaultValue={term}
            autoFocus
            placeholder="Ada, ada@…, 07700…"
            className="mt-2"
          />
        </div>
        <Button type="submit">Search</Button>
      </form>

      <NewClient salonSlug={salon} />

      {term.length >= 2 && results.length === 0 && (
        <EmptyState
          title={`Nobody matching “${term}”`}
          description="Check the spelling, or try their phone number instead."
        />
      )}

      {results.length > 0 && (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {results.map((client) => (
            <li key={client.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body font-medium text-ink">
                    {`${client.firstName} ${client.lastName ?? ''}`.trim()}
                  </span>
                  {client.completedVisits === 0 && <Badge tone="info">New</Badge>}
                  {client.noShowCount > 0 && (
                    <Badge tone="warn">
                      {client.noShowCount} no-show{client.noShowCount === 1 ? '' : 's'}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-secondary text-ink-muted">
                  {[client.email, client.phone].filter(Boolean).join(' · ') || 'No contact details'}
                </p>
              </div>

              <div className="flex items-center gap-4">
                <span className="tabular text-secondary text-ink-subtle">
                  {client.completedVisits} visit{client.completedVisits === 1 ? '' : 's'}
                </span>
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/s/${salon}/desk/clients/${client.id}`}>Open</Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
