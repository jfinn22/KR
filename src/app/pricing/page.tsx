import * as React from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FEATURES, PLANS, hasFeature, limitsFor, type Feature } from '@/domain/authz/plan-features'

export const metadata = {
  title: 'Pricing — Salon Intelligence',
  description: 'Three plans, and exactly what each one includes.',
}

/**
 * What the three plans cost, and what they actually do.
 *
 * Built from `PLANS` rather than retyped, because a pricing page that restates
 * the tiers in prose is one that goes out of date the first time a feature
 * moves between them — and the version a customer read is the one they think
 * they bought. Every row here is the same data `requireFeature` consults, so
 * the page cannot promise something the guard will refuse.
 *
 * The landing page linked here from the day it shipped and this route did not
 * exist, so "See pricing" was a 404 on the platform's own front door.
 */

/** Grouped for reading, not by tier — a buyer scans by what they want to do. */
const GROUPS: { title: string; features: Feature[] }[] = [
  {
    title: 'Consultation',
    features: [
      'CONSULTATION_ENGINE',
      'RISK_DETECTION',
      'MULTI_SESSION_PLANNING',
      'CUSTOM_CONSULT_TEMPLATES',
      'RULE_CONFIGURATION',
    ],
  },
  {
    title: 'The hair record',
    features: ['HAIR_TIMELINE', 'FORMULA_HISTORY'],
  },
  {
    title: 'The diary',
    features: ['HOLD_MY_SPOT', 'WAITLIST_AUTOFILL', 'SPECIALTY_ROUTING', 'MULTI_LOCATION'],
  },
  {
    title: 'Money',
    features: ['DEPOSITS', 'QUOTE_ACCURACY'],
  },
  {
    title: 'Keeping people',
    features: ['REBOOKING_AUTOMATION', 'RETENTION_AUTOMATION'],
  },
  {
    title: 'What you can see',
    features: ['ANALYTICS_BASIC', 'ANALYTICS_ADVANCED', 'TEAM_DASHBOARDS'],
  },
  {
    title: 'Assistance',
    features: ['AI_SUMMARIES', 'AI_PHOTO_ANALYSIS', 'AI_FORMULA_SUGGEST'],
  },
  {
    title: 'Everything else',
    features: ['BRANDED_EXPERIENCE', 'API_ACCESS', 'PRIORITY_SUPPORT'],
  },
]

const LABELS: Record<Feature, string> = {
  CONSULTATION_ENGINE: 'The consultation itself',
  RISK_DETECTION: 'Box dye, henna and the rest, caught before booking',
  MULTI_SESSION_PLANNING: 'Work planned across several visits',
  FORMULA_HISTORY: 'Every formula, kept',
  HAIR_TIMELINE: 'The client’s hair, visit by visit',
  DEPOSITS: 'Deposits held against a card',
  WAITLIST_AUTOFILL: 'A waiting list that fills cancellations',
  HOLD_MY_SPOT: 'Slots held while a client decides',
  REBOOKING_AUTOMATION: 'Rebooking reminders that go out on their own',
  RETENTION_AUTOMATION: 'The clients you are quietly losing, listed',
  ANALYTICS_BASIC: 'Takings, no-shows and chair time',
  ANALYTICS_ADVANCED: 'Estimate accuracy, funnels and where time goes',
  QUOTE_ACCURACY: 'Estimates measured against what actually happened',
  CUSTOM_CONSULT_TEMPLATES: 'Your own consultation questions',
  RULE_CONFIGURATION: 'Your own rules about what to refuse',
  AI_SUMMARIES: 'Consultations summarised for the stylist',
  AI_PHOTO_ANALYSIS: 'Photographs read for level and condition',
  AI_FORMULA_SUGGEST: 'Formula suggestions, for a colourist to accept or reject',
  MULTI_LOCATION: 'More than one salon',
  TEAM_DASHBOARDS: 'Each stylist’s own numbers',
  SPECIALTY_ROUTING: 'Work routed to whoever can do it',
  BRANDED_EXPERIENCE: 'Your own colour and logo throughout',
  API_ACCESS: 'The API',
  PRIORITY_SUPPORT: 'Support that answers first',
}

const ORDER = ['STARTER', 'PRO', 'SALON'] as const

export default function PricingPage() {
  return (
    <main className="app-wash">
      <header className="border-b border-line bg-canvas">
        <nav className="mx-auto flex max-w-shell items-center justify-between px-6 py-5 lg:px-10">
          <Link href="/" className="font-display text-display-sm text-ink">
            Salon Intelligence
          </Link>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </nav>
      </header>

      <div className="hero-wash">
        <section className="mx-auto max-w-shell px-6 py-16 lg:px-10">
          <h1 className="max-w-3xl text-balance font-display text-display-xl text-ink">
            Three plans. What each one includes, in full.
          </h1>
          <p className="mt-5 max-w-prose text-pretty text-body text-ink-muted">
            No feature is described here that the product will not actually do — this page is
            generated from the same definitions the software checks against.
          </p>
        </section>
      </div>

      <section className="mx-auto max-w-shell px-6 pb-8 lg:px-10">
        <div className="grid gap-5 lg:grid-cols-3">
          {ORDER.map((code) => {
            const plan = PLANS[code]
            const limits = limitsFor(code)
            return (
              <div
                key={code}
                className={
                  code === 'PRO'
                    ? 'flex flex-col gap-4 rounded-lg border-l-4 border-l-gold-500 bg-gold-100/50 p-6'
                    : 'flex flex-col gap-4 rounded-lg border border-line bg-surface p-6'
                }
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-display text-display-sm text-ink">{plan.name}</span>
                  {code === 'PRO' && <Badge tone="gold">Most salons</Badge>}
                </div>
                <p className="text-secondary text-ink-muted">{plan.tagline}</p>
                <p className="tabular font-display text-display-lg text-ink">
                  {(plan.monthlyPriceCents / 100).toFixed(0)}
                  <span className="text-body text-ink-muted"> / month</span>
                </p>
                <p className="tabular text-label text-ink-subtle">
                  or {(plan.yearlyPriceCents / 100).toFixed(0)} a year
                </p>
                <ul className="flex flex-col gap-1 text-secondary text-ink-muted">
                  <li>
                    {limits.maxStylists === 1
                      ? 'One stylist'
                      : `Up to ${limits.maxStylists} stylists`}
                  </li>
                  <li>
                    {limits.maxLocations === 1
                      ? 'One location'
                      : `Up to ${limits.maxLocations} locations`}
                  </li>
                  <li>{limits.monthlySmsIncluded.toLocaleString()} texts a month</li>
                  <li>{limits.photoStorageGb} GB of photographs</li>
                </ul>
              </div>
            )
          })}
        </div>
      </section>

      <section className="mx-auto max-w-shell px-6 py-12 lg:px-10">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <th className="label-caps py-3 pr-4">Included</th>
                {ORDER.map((code) => (
                  <th key={code} className="label-caps w-28 py-3 text-center">
                    {PLANS[code].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((group) => (
                <React.Fragment key={group.title}>
                  <tr>
                    <td colSpan={4} className="pb-2 pt-7 font-display text-display-sm text-ink">
                      {group.title}
                    </td>
                  </tr>
                  {group.features.map((feature) => (
                    <tr key={feature} className="border-b border-line">
                      <td className="py-3 pr-4 text-body text-ink">{LABELS[feature]}</td>
                      {ORDER.map((code) => (
                        <td key={code} className="py-3 text-center">
                          {hasFeature(code, feature) ? (
                            <span aria-label="included" className="text-gold-500">
                              ●
                            </span>
                          ) : (
                            <span aria-label="not included" className="text-ink-subtle">
                              –
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/*
         * A guard against this page and the software drifting apart: if a
         * feature is added to the union and nobody puts it in a group above, it
         * is listed here rather than silently going unmentioned.
         */}
        {FEATURES.filter((f) => !GROUPS.some((g) => g.features.includes(f))).length > 0 && (
          <p className="mt-6 text-secondary text-ink-muted">
            Also included where your plan allows:{' '}
            {FEATURES.filter((f) => !GROUPS.some((g) => g.features.includes(f)))
              .map((f) => LABELS[f])
              .join(', ')}
            .
          </p>
        )}
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-shell flex-wrap items-center justify-between gap-4 px-6 py-8 lg:px-10">
          <p className="text-secondary text-ink-muted">
            Already with us?{' '}
            <Link href="/login" className="text-blue-500 hover:underline">
              Sign in
            </Link>
            .
          </p>
          <Link href="/" className="text-secondary text-blue-500 hover:underline">
            Back
          </Link>
        </div>
      </footer>
    </main>
  )
}
