import { pageContextFor } from '@/server/auth/page'
import { salonPlans } from '@/server/services/memberships'
import { entitlementsOf } from '@/domain/commerce/membership'
import { SectionHeading, Table, TableWrap, Td, Th, Tr } from '@/components/ui/data'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { PlanEditor } from './plan-editor'

export const dynamic = 'force-dynamic'

/**
 * Memberships the salon sells.
 *
 * The point of a membership is not the monthly fee — it is that somebody who
 * has prepaid comes back, and comes back to you rather than to whoever is
 * cheaper this month. Which means the benefit has to be visible on the bill,
 * which means it has to be typed rather than described, which is why this screen
 * asks for rows instead of a paragraph.
 */
export default async function MembershipsPage({ params }: { params: Promise<{ salon: string }> }) {
  const { salon } = await params
  const ctx = await pageContextFor(salon, 'billing.manage')

  const [plans, services] = await Promise.all([
    salonPlans(ctx.salonId),
    ctx.db.service.findMany({
      where: { salonId: ctx.salonId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return (
    <div className="flex flex-col gap-12">
      <header>
        <h1 className="heading-flourish font-display text-display-lg text-ink">Memberships</h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          Something a client pays for every month, and gets back every time they come in. What it
          includes is applied at the till, where they can watch it happen — which is the only reason
          anybody keeps paying for one.
        </p>
      </header>

      <section>
        <SectionHeading
          title="What you offer"
          description="A membership with people on it can be edited, but think carefully — they joined the one you described."
        />
        <div className="mt-6">
          {plans.length === 0 ? (
            <EmptyState
              title="Nothing on offer yet"
              description="A membership is worth building once you know which service your regulars come in for most."
            />
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Plan</Th>
                    <Th>Price</Th>
                    <Th>Includes</Th>
                    <Th>Members</Th>
                    <Th>State</Th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <Tr key={plan.id}>
                      <Td>
                        <span className="font-medium text-ink">{plan.name}</span>
                      </Td>
                      <Td className="tabular">
                        {(plan.priceCents / 100).toFixed(2)} / {plan.interval.toLowerCase()}
                      </Td>
                      <Td>
                        {entitlementsOf(plan.includedJson)
                          .map((e) => e.label)
                          .join(', ') || '—'}
                      </Td>
                      <Td className="tabular">{plan._count.memberships}</Td>
                      <Td>
                        <Badge tone={plan.isActive ? 'success' : 'neutral'}>
                          {plan.isActive ? 'On offer' : 'Closed'}
                        </Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </div>
      </section>

      <section>
        <SectionHeading title="Add one" description="Benefits are rows so the till can apply them." />
        <div className="mt-6">
          <PlanEditor salonSlug={salon} services={services} plan={null} />
        </div>
      </section>
    </div>
  )
}
