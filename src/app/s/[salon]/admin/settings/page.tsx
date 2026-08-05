import { pageContextFor } from '@/server/auth/page'
import { joinCodeFor, schedulingSettings } from '@/server/services/settings'
import { brandingForSlug } from '@/server/services/branding'
import { hasFeature } from '@/domain/authz/plan-features'
import { SectionHeading } from '@/components/ui/data'
import { SchedulingSettingsForm } from './scheduling-form'
import { BrandingForm } from './branding-form'
import { JoinForm } from './join-form'

export const dynamic = 'force-dynamic'

/**
 * How the salon is configured.
 *
 * One page with sections rather than sub-routes. Everything here is small,
 * infrequently changed, and read together — an owner turning on interleaving
 * usually wants to see what else is set at the same time. Phases 4 onwards add
 * discounts, deposit presets, gift cards and notification schedules as further
 * sections; when the page stops being scannable in one screen it should split,
 * and not before.
 */
export default async function SettingsPage({ params }: { params: Promise<{ salon: string }> }) {
  const { salon } = await params
  const ctx = await pageContextFor(salon, 'settings.manage')

  const [scheduling, branding, joinCode] = await Promise.all([
    schedulingSettings(ctx.salonId),
    brandingForSlug(salon),
    joinCodeFor(ctx.salonId),
  ])

  const mayBrand = hasFeature(ctx.plan, 'BRANDED_EXPERIENCE')

  return (
    <div className="flex flex-col gap-12">
      <header>
        <h1 className="heading-flourish font-display text-display-lg text-ink">Settings</h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          How this salon runs. These change what everybody else sees — the diary, the estimates, and
          the way the whole product looks to your clients.
        </p>
      </header>

      <section>
        <SectionHeading
          title="How clients join you"
          description="Everything a new client needs to find you and make an account. There is no directory on this platform — clients arrive through your own link, which means they arrive as yours."
        />
        <div className="mt-6">
          <JoinForm
            salonSlug={salon}
            salonName={ctx.salonName}
            initialCode={joinCode}
            appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ''}
          />
        </div>
      </section>

      <section>
        <SectionHeading
          title="Handing on the chair"
          description="Whether the calendar may sell a stylist's processing time to somebody else. Off by default — it is the highest-variance thing this product does, so it is opted into deliberately."
        />
        <div className="mt-6">
          <SchedulingSettingsForm salonSlug={salon} initial={scheduling} />
        </div>
      </section>

      <section>
        <SectionHeading
          title="Your branding"
          description="Your colour and your logo, used everywhere your clients see the platform — including the pages they land on before they have an account."
        />
        <div className="mt-6">
          <BrandingForm
            salonSlug={salon}
            initialAccent={branding?.accentHex ?? null}
            available={mayBrand}
          />
        </div>
      </section>
    </div>
  )
}
