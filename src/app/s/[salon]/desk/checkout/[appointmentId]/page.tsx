import Link from 'next/link'
import { pageContextFor } from '@/server/auth/page'
import { checkoutView } from '@/server/services/front-desk'
import { discountReasons } from '@/server/services/commerce'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { Till } from './till'

export const dynamic = 'force-dynamic'

/**
 * The till.
 *
 * The last thing that happens with a client in front of you, and the screen
 * where a mistake costs money in both directions. It shows what was agreed,
 * what has already been paid, and what is left — and nothing else, because
 * this is not the moment to be reading a dashboard.
 */
export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ salon: string; appointmentId: string }>
}) {
  const { salon, appointmentId } = await params
  const ctx = await pageContextFor(salon, 'payment.take')

  const [view, discountOptions] = await Promise.all([
    checkoutView(ctx.salonId, appointmentId),
    // The reasons the owner wrote. An empty list is an ordinary state — a salon
    // that has configured none simply has no dropdown to offer.
    discountReasons(ctx.salonId),
  ])
  if (!view) {
    return (
      <EmptyState
        title="Nothing to settle"
        description="That appointment is not ready to be checked out."
        action={
          <Button asChild>
            <Link href={`/s/${salon}/desk`}>Back to today</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/s/${salon}/desk`}>← Today</Link>
        </Button>
      </div>

      <header>
        <h1 className="font-display text-display-lg text-ink">{view.clientName}</h1>
        <p className="mt-2 text-body text-ink-muted">
          {view.serviceNames.join(' + ')} with {view.stylistName}
        </p>
      </header>

      <Till
        salonSlug={salon}
        appointmentId={appointmentId}
        currency={ctx.currency}
        lines={view.lines}
        agreedTotalCents={view.agreedTotalCents}
        depositHeldCents={view.depositHeldCents}
        discountOptions={discountOptions}
        invoice={view.invoice}
      />
    </div>
  )
}
