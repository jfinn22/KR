import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const DIFFERENTIATORS = [
  {
    title: 'Consultation before booking',
    body: 'A guided intake captures hair history, goals and photos, then decides whether the service is realistic — before a slot is ever held.',
  },
  {
    title: 'Risk detection that suggests a path',
    body: 'Box dye under a high-lift goal, henna before a lightener, extensions on fragile hair. Every flag arrives with a recommended route, never a flat refusal.',
  },
  {
    title: 'Slots that actually fit',
    body: 'Duration comes from the approved plan and the stylist’s own calibration, so clients only ever see times that genuinely work.',
  },
  {
    title: 'A hair record that compounds',
    body: 'Formulas, condition, before and after photos, and stylist observations build one continuous timeline across every visit.',
  },
]

export default function LandingPage() {
  return (
    <main className="app-wash">
      <header className="border-b border-line bg-canvas">
        <nav className="mx-auto flex max-w-shell items-center justify-between px-6 py-5 lg:px-10">
          <span className="font-display text-display-sm text-ink">Salon Intelligence</span>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            {/*
             * "See pricing", not "Start free".
             *
             * Both CTAs on this page pointed at /signup and /pricing, and
             * neither route existed — the platform's own front door was two
             * 404s. There is also no self-serve way to create a salon: every
             * salon on this platform is onboarded with its catalogue and staff
             * in place, which is the honest thing to say rather than promising
             * a free start that lands nowhere.
             */}
            <Button size="sm" asChild>
              <Link href="/pricing">See pricing</Link>
            </Button>
          </div>
        </nav>
      </header>

      {/* Full-bleed so the wash has no seam where the shell ends. */}
      <div className="hero-wash">
        <section className="mx-auto max-w-shell px-6 py-20 lg:px-10 lg:py-28">
          <Badge tone="gold">Built for salons that do more than book</Badge>
          <h1 className="mt-6 max-w-4xl text-balance font-display text-display-xl text-ink lg:text-[3.25rem] lg:leading-[1.1]">
            Most salon software books the appointment. This one works out whether the appointment is
            right.
          </h1>
          <p className="mt-6 max-w-prose text-pretty text-body text-ink-muted">
            A consultation-first operating system for hair salons. Clients arrive understood,
            stylists arrive prepared, and the front desk stops fixing bookings that should never
            have been made.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button size="lg" asChild>
              <Link href="/pricing">See what it costs</Link>
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
          <p className="mt-4 text-secondary text-ink-muted">
            Already a client of a salon on here? Use the link your salon gave you — there is no
            directory, and that is deliberate.
          </p>
        </section>
      </div>

      <hr className="rule-gold mx-auto max-w-shell" />

      <section className="mx-auto max-w-shell px-6 py-20 lg:px-10">
        <div className="grid gap-5 sm:grid-cols-2">
          {DIFFERENTIATORS.map((d) => (
            <Card key={d.title}>
              <CardHeader>
                <CardTitle>{d.title}</CardTitle>
                <CardDescription>{d.body}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          ))}
        </div>
      </section>

      {/*
       * Navy, so the page closes on the same colour the product's own shell is
       * built from — a visitor who signs up meets the nav column already
       * knowing what it looks like. The gilt edge above it is the same hairline
       * that sits at the top of every screen inside.
       */}
      <footer className="panel-navy">
        <div aria-hidden="true" className="edge-gilt" />
        <div className="mx-auto flex max-w-shell flex-wrap items-center justify-between gap-4 px-6 py-10 lg:px-10">
          <p className="text-secondary text-white/75">
            Salon Intelligence Platform — consultation, scheduling and hair records in one place.
          </p>
          <Link
            href="/design-system"
            className="text-secondary font-medium text-gold-300 underline-offset-4 hover:underline"
          >
            Design system
          </Link>
        </div>
      </footer>
    </main>
  )
}
