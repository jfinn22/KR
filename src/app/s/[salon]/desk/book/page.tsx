import Link from 'next/link'
import { notFound } from 'next/navigation'
import { pageContextFor } from '@/server/auth/page'
import { listCatalog } from '@/server/services/catalog'
import { clientRecord } from '@/server/services/front-desk'
import { findClients } from '@/server/services/front-desk'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { Input, Label } from '@/components/ui/field'
import { localDateIn } from '@/lib/format'
import { loadGap } from '@/server/services/scheduling/gap-fill'
import { DeskBooking } from './desk-booking'

export const dynamic = 'force-dynamic'

/**
 * Putting somebody in the diary from behind the desk.
 *
 * Everything this needs existed and had no door: `bookDirect` takes an
 * arbitrary slot and chain, the loader is chain-generic, and the solver never
 * knew what a `ServicePlan` was. The only missing piece was a search that does
 * not begin by loading a plan — and, before that, a decision about when a
 * consultation is actually required, which is what `bookingGate` is.
 *
 * Client first, then services, then times. That order because the gate depends
 * on both the client and the services: whether a patch test is on file is a
 * fact about the person, and whether one is needed is a fact about the
 * service.
 */
export default async function DeskBookPage({
  params,
  searchParams,
}: {
  params: Promise<{ salon: string }>
  searchParams: Promise<{ q?: string; client?: string; fill?: string }>
}) {
  const [{ salon }, query] = await Promise.all([params, searchParams])
  const ctx = await pageContextFor(salon, 'appointment.bookDirect')

  /*
   * Arriving from a gold block in the diary. Loaded here rather than trusted
   * from the URL: `loadGap` refuses anything that is not an actual processing
   * gap, so a hand-typed segment id gets a refusal instead of a booking.
   */
  const gap = query.fill ? await loadGap(ctx.salonId, query.fill) : null
  const carry = gap ? `&fill=${gap.segmentId}` : ''

  // No client chosen yet: the same one-box search the desk already knows.
  if (!query.client) {
    const term = (query.q ?? '').trim()
    const results = term.length >= 2 ? await findClients(ctx.salonId, term) : []

    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header>
          <h1 className="heading-flourish font-display text-display-lg text-ink">
            {gap ? 'Fill the gap' : 'Book an appointment'}
          </h1>
          {gap ? (
            <p className="mt-2 text-body text-ink-muted">
              {gap.stylistName} is free while {gap.occupiedBy} processes. Who is going in?
            </p>
          ) : (
            <p className="mt-2 text-body text-ink-muted">
              Who is it for? Name, email or phone — whichever they gave you.
            </p>
          )}
        </header>

        <form action={`/s/${salon}/desk/book`} method="get" className="flex items-end gap-3">
          {gap && <input type="hidden" name="fill" value={gap.segmentId} />}
          <div className="flex-1">
            <Label htmlFor="q">Search</Label>
            <Input id="q" name="q" defaultValue={term} placeholder="Ada, or 07…" autoFocus />
          </div>
          <Button type="submit">Search</Button>
        </form>

        {term.length >= 2 && results.length === 0 && (
          <EmptyState
            title="Nobody by that name"
            description="Add them from the client screen first, then come back."
            action={
              <Button asChild variant="secondary">
                <Link href={`/s/${salon}/desk/clients?q=${encodeURIComponent(term)}`}>
                  Go to clients
                </Link>
              </Button>
            }
          />
        )}

        {results.length > 0 && (
          <ul className="flex flex-col gap-2">
            {results.map((client) => (
              <li key={client.id}>
                <Link
                  href={`/s/${salon}/desk/book?client=${client.id}${carry}`}
                  className="flex items-center justify-between rounded-md border border-line px-4 py-3 transition-colors hover:border-gold-500"
                >
                  <span className="text-body text-ink">
                    {`${client.firstName} ${client.lastName ?? ''}`.trim()}
                  </span>
                  <span className="text-secondary text-ink-muted">
                    {client.email ?? client.phone ?? 'No contact details'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const record = await clientRecord(ctx.salonId, query.client)
  if (!record) notFound()

  /*
   * The full catalog, not the online-bookable subset. A service a salon keeps
   * off its public booking page is usually one it wants a conversation about
   * first — and this IS that conversation, with the desk on the phone.
   */
  const categories = await listCatalog(ctx.salonId)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/s/${salon}/desk/book?${carry.slice(1)}`}>← Someone else</Link>
        </Button>
      </div>

      <DeskBooking
        salonSlug={salon}
        timeZone={ctx.timezone}
        currency={ctx.currency}
        clientProfileId={record.client.id}
        clientName={`${record.client.firstName} ${record.client.lastName ?? ''}`.trim()}
        today={localDateIn(ctx.timezone)}
        gap={
          gap && {
            segmentId: gap.segmentId,
            stylistName: gap.stylistName,
            occupiedBy: gap.occupiedBy,
            localDate: gap.localDate,
            minutes: gap.endMin - gap.startMin,
          }
        }
        categories={categories.map((category) => ({
          id: category.id,
          name: category.name,
          services: category.services.map((service) => ({
            id: service.id,
            name: service.name,
            priceCents: service.basePriceCents,
            requiresConsultation: service.requiresConsultation,
            isChemical: service.isChemical,
          })),
        }))}
      />
    </div>
  )
}
