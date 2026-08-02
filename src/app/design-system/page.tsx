import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { AiSuggestion, EmptyState, ProgressRail, RiskFlagCard } from '@/components/ui/feedback'
import {
  DetailList,
  SectionHeading,
  Stat,
  Table,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/data'

export const metadata = { title: 'Design system' }

const SWATCHES = [
  ['Ink', '--ink', '#0B0B0C'],
  ['Ink muted', '--ink-muted', '#55555C'],
  ['Canvas', '--canvas', '#FFFFFF'],
  ['Surface', '--surface', '#FAFAFB'],
  ['Surface alt', '--surface-alt', '#F4F5F7'],
  ['Line', '--line', '#E6E7EB'],
  ['Blue 900', '--blue-900', '#0F2A4A'],
  ['Blue 700', '--blue-700', '#1B4C7E'],
  ['Blue 500', '--blue-500', '#2E6FA8'],
  ['Blue 100', '--blue-100', '#E8F0F8'],
  ['Gold 700', '--gold-700', '#8A6C1F'],
  ['Gold 600', '--gold-600', '#A8842C'],
  ['Gold 500', '--gold-500', '#C9A227'],
  ['Gold 100', '--gold-100', '#FBF5E3'],
  ['Success', '--success', '#2F6B4F'],
  ['Warn', '--warn', '#B07A12'],
  ['Danger', '--danger', '#A32E2E'],
]

/**
 * Living reference for the salon design system. Committed deliberately: it is
 * how a reviewer checks that a new screen matches the system, and how the
 * palette stays honest.
 */
export default function DesignSystemPage() {
  return (
    <main className="mx-auto max-w-shell px-6 py-12 lg:px-10">
      <header className="mb-12">
        <p className="label-caps">Reference</p>
        <h1 className="mt-2 font-display text-display-xl text-ink">Design system</h1>
        <p className="mt-3 max-w-prose text-body text-ink-muted">
          White, blue and gold with black text. Generous whitespace, hairline borders, almost
          invisible shadows. Gold is a garnish — it marks distinction and status, and never fills a
          surface or carries body copy.
        </p>
        <hr className="rule-gold mt-6" />
      </header>

      <section className="mb-14">
        <SectionHeading
          title="Palette"
          description="Declared once in globals.css as custom properties."
        />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {SWATCHES.map(([name, token, hex]) => (
            <div key={token} className="rounded-lg border border-line bg-canvas p-3 shadow-card">
              <div
                className="mb-3 h-14 w-full rounded-md border border-line"
                style={{ background: `rgb(var(${token}))` }}
              />
              <p className="text-secondary font-medium text-ink">{name}</p>
              <p className="tabular text-label text-ink-subtle">{hex}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-14">
        <SectionHeading
          title="Typography"
          description="Cormorant Garamond for display, Inter for everything operational."
        />
        <div className="space-y-4">
          <p className="font-display text-display-xl text-ink">Corrective colour consultation</p>
          <p className="font-display text-display-lg text-ink">Aurora Hair Studio</p>
          <p className="font-display text-display-md text-ink">Your hair timeline</p>
          <p className="text-body text-ink">
            Body copy is Inter at 16px with a 1.6 line height, always in near-black. It should read
            comfortably at arm&apos;s length on a salon tablet.
          </p>
          <p className="text-secondary text-ink-muted">
            Secondary copy steps down to 14px and to muted ink for supporting detail.
          </p>
          <p className="label-caps">Uppercase micro-label</p>
        </div>
      </section>

      <section className="mb-14">
        <SectionHeading title="Buttons" />
        <div className="flex flex-wrap items-center gap-3">
          <Button>Approve consultation</Button>
          <Button variant="secondary">Request more photos</Button>
          <Button variant="gold">Upgrade to Pro</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger-quiet">Decline</Button>
          <Button variant="link">View hair history</Button>
          <Button size="sm" variant="secondary">
            Small
          </Button>
          <Button disabled>Disabled</Button>
        </div>
      </section>

      <section className="mb-14">
        <SectionHeading title="Badges" />
        <div className="flex flex-wrap gap-2">
          <Badge>Draft</Badge>
          <Badge tone="info">In review</Badge>
          <Badge tone="gold">Approved</Badge>
          <Badge tone="success">Deposit paid</Badge>
          <Badge tone="warn">Awaiting patch test</Badge>
          <Badge tone="danger">Blocked</Badge>
          <Badge tone="outline">Booth renter</Badge>
        </div>
      </section>

      <section className="mb-14">
        <SectionHeading title="Cards & stats" />
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Booking conversion"
            value="68%"
            delta="+4.2 pts"
            deltaDirection="up-good"
            hint="vs last month"
          />
          <Stat
            label="Quote accuracy"
            value="91%"
            delta="+1.8 pts"
            deltaDirection="up-good"
            hint="est. vs actual"
          />
          <Stat
            label="No-show rate"
            value="3.1%"
            delta="+0.6 pts"
            deltaDirection="up-bad"
            hint="vs last month"
          />
          <Stat label="Chair utilisation" value="77%" delta="flat" deltaDirection="flat" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Standard card</CardTitle>
              <CardDescription>Hairline border, generous padding, quiet shadow.</CardDescription>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  { label: 'Service', value: 'Full balayage + gloss' },
                  { label: 'Estimated', value: '4h 15m' },
                  { label: 'Stylist', value: 'Rowan M.' },
                  { label: 'Deposit', value: '$95.00' },
                ]}
              />
            </CardContent>
          </Card>
          <Card featured>
            <CardHeader>
              <CardTitle>Featured card</CardTitle>
              <CardDescription>
                A 2px gold top-rule marks distinction. Used sparingly.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-secondary text-ink">
                Reserved for the approved plan, the premium tier, and the one thing on a screen that
                genuinely deserves the eye.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mb-14">
        <SectionHeading
          title="Consultation progress"
          description="A slim gold rail, never a chunky bar."
        />
        <div className="max-w-md space-y-3">
          <ProgressRail value={3} max={7} />
          <p className="text-secondary text-ink-muted">Step 3 of 7 — hair history</p>
        </div>
      </section>

      <section className="mb-14">
        <SectionHeading
          title="Risk flags"
          description="Left border-accent. Every flag carries a recommended path."
        />
        <div className="space-y-4">
          <RiskFlagCard
            severity="HIGH"
            title="Box dye on the lengths with a high-lift goal"
            detail="Home colour reported 4 months ago on the mid-lengths and ends, with a 5-level lift requested. Box dye deposits unevenly, so lift is unpredictable and banding is likely in a single session."
            recommendedPath="Plan three lightening sessions 6–8 weeks apart with a bond builder, and run a strand test at the first appointment before committing to the full head."
            evidence={[
              { label: 'Most recent box dye', value: '4 months ago' },
              { label: 'Current level (mids)', value: '4' },
              { label: 'Target level', value: '9' },
            ]}
          />
          <RiskFlagCard
            severity="CAUTION"
            title="Patch test needed before this appointment"
            detail="No valid patch test on file. A test is required at least 48 hours before any dye service."
            recommendedPath="Pop in for a five-minute patch test, then book any slot 48+ hours later. We'll hold your preferred time for 72 hours."
          />
        </div>
      </section>

      <section className="mb-14">
        <SectionHeading
          title="AI suggestions"
          description="Always visibly advisory, always requiring a human action."
        />
        <AiSuggestion
          actions={
            <>
              <Button size="sm">Accept</Button>
              <Button size="sm" variant="secondary">
                Edit
              </Button>
              <Button size="sm" variant="ghost">
                Dismiss
              </Button>
            </>
          }
        >
          Client reports a level 4 base with box dye through the ends and wants a level 9 cool
          blonde. Photos show visible banding from mid-shaft down and some dryness at the ends.
        </AiSuggestion>
      </section>

      <section className="mb-14">
        <SectionHeading title="Forms" />
        <div className="grid max-w-2xl gap-5 sm:grid-cols-2">
          <Field label="Full name" htmlFor="d-name" required>
            <Input id="d-name" placeholder="Alex Rivera" />
          </Field>
          <Field label="Natural level" htmlFor="d-level" help="1 is black, 10 is lightest blonde.">
            <Select id="d-level" defaultValue="">
              <option value="" disabled>
                Select a level
              </option>
              {Array.from({ length: 10 }, (_, i) => (
                <option key={i + 1}>{i + 1}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="What do you love about this photo?"
            htmlFor="d-note"
            className="sm:col-span-2"
          >
            <Textarea
              id="d-note"
              placeholder="The brightness around the face, but softer at the roots…"
            />
          </Field>
          <Field label="Email" htmlFor="d-email" error="Enter a valid email address.">
            <Input id="d-email" aria-invalid defaultValue="alex@" />
          </Field>
        </div>
      </section>

      <section className="mb-14">
        <SectionHeading title="Tables" />
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Client</Th>
                <Th>Service</Th>
                <Th>Estimated</Th>
                <Th>Actual</Th>
                <Th>Variance</Th>
              </tr>
            </thead>
            <tbody>
              <Tr>
                <Td>Priya N.</Td>
                <Td>Root touch-up + gloss</Td>
                <Td className="tabular">1h 45m</Td>
                <Td className="tabular">1h 50m</Td>
                <Td className="tabular text-ink-muted">+5m</Td>
              </Tr>
              <Tr>
                <Td>Marcus D.</Td>
                <Td>Full balayage</Td>
                <Td className="tabular">3h 30m</Td>
                <Td className="tabular">4h 20m</Td>
                <Td className="tabular text-danger">+50m</Td>
              </Tr>
              <Tr>
                <Td>Sam O.</Td>
                <Td>Cut &amp; finish</Td>
                <Td className="tabular">45m</Td>
                <Td className="tabular">40m</Td>
                <Td className="tabular text-success">−5m</Td>
              </Tr>
            </tbody>
          </Table>
        </TableWrap>
      </section>

      <section className="mb-14">
        <SectionHeading title="Empty state" />
        <EmptyState
          title="No consultations waiting"
          description="When a client submits a consultation it lands here with a review countdown."
          action={<Button variant="secondary">View all clients</Button>}
        />
      </section>
    </main>
  )
}
