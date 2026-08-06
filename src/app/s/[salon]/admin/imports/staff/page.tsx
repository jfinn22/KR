import Link from 'next/link'
import { pageContextFor } from '@/server/auth/page'
import { Button } from '@/components/ui/button'
import { SectionHeading } from '@/components/ui/data'
import { EmptyState } from '@/components/ui/feedback'
import { StaffImport } from './staff-import'

export const dynamic = 'force-dynamic'

/**
 * The team, before their appointments.
 *
 * `previewStaffImport` and `commitStaffImport` were written with the migration
 * track and never got a screen — so the one thing a salon must do before
 * importing four thousand appointments, namely have the stylists those
 * appointments belong to, could only be done by hand one at a time.
 *
 * Deliberately shallow: names and skills, never schedules. Working hours come
 * out of the old system in a shape nobody can trust, and a wrong one silently
 * removes a stylist's Saturday from the diary.
 */
export default async function StaffImportPage({
  params,
}: {
  params: Promise<{ salon: string }>
}) {
  const { salon } = await params
  const ctx = await pageContextFor(salon, 'migration.import')

  const locations = await ctx.db.location.findMany({
    where: { salonId: ctx.salonId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="flex flex-col gap-10">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/s/${salon}/admin/imports`}>← Imports</Link>
        </Button>
      </div>

      <header>
        <h1 className="heading-flourish font-display text-display-lg text-ink">Bring the team across</h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          Do this before the appointments. An appointment needs a stylist, and one imported against
          somebody who is not here yet has nowhere to go.
        </p>
      </header>

      <section>
        <SectionHeading
          title="From your old system"
          description="Names and skills. Nothing here touches anybody's working hours — those come out of most systems in a shape nobody can trust, and a wrong one quietly removes a Saturday from the diary."
        />
        <div className="mt-6">
          {locations.length === 0 ? (
            <EmptyState
              title="No locations yet"
              description="Add a location first — a stylist has to work somewhere before they can be booked."
            />
          ) : (
            <StaffImport salonSlug={salon} locations={locations} />
          )}
        </div>
      </section>
    </div>
  )
}
