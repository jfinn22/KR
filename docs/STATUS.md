# Build status

An honest account of what exists and what does not. All 18 workstreams are
built; this records what that means in practice and what a salon would still
want before running on it.

## CI

All three jobs green:

| Job           | Runs                                                                |
| ------------- | ------------------------------------------------------------------- |
| `static`      | typecheck, lint, format:check, unit tests, adapter contracts        |
| `integration` | migrations + tenant isolation + booking race, against real Postgres |
| `e2e`         | seed + Playwright against a production build on mock adapters       |

`static` also runs `check:boundary`, which fails the build if a server
component imports a plain helper from a `'use client'` module. That mistake
typechecks, lints and builds, then throws an opaque 500 with a digest and no
stack at render time — nothing else in the pipeline catches it, and it cost
real debugging time before the check existed.

Counts: **419 unit**, **83 integration**, **48 end-to-end**.

---

## Built and tested

|                            | What it covers                                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W0** Foundation          | Next.js 15 + TS strict, the salon design system (white/blue/gold, black text, Cormorant Garamond over Inter), `/design-system`, WCAG AA contrast test that caught two real failures in the palette |
| **W1** Data model          | 99 models; GiST exclusion constraints proving overlapping bookings and holds are rejected while back-to-back and processing overlap are accepted; RLS on every tenant table                        |
| **W2** Tenancy & authz     | 60-action × 5-role matrix, `dbFor()` scoping extension, `withAuthz` as the single mutation path, DMMF test that fails if a model skips the tenancy decision                                        |
| **W3** Ports & adapters    | Seven ports, mock + real, one shared contract suite. EXIF stripping, payment idempotency, PII refusal on the AI port                                                                               |
| **W5** Scheduling          | Pure interval solver with phase chains, interleaving, resource assignment and gap-fill ranking; DST across four zones; 25-way concurrent booking race proven safe                                  |
| **W6** Consultation engine | 17 rules, deterministic and versioned; every flag carries a recommended path; order-independence proven against a reversed ruleset                                                                 |
| **W12** Jobs               | Postgres queue with `FOR UPDATE SKIP LOCKED`, long-lived worker, outbox dispatch, reminders, hold expiry, waitlist matching, calibration                                                           |
| **W17** Seed & e2e         | Deterministic Aurora Hair Studio demo; Playwright suite against a production build                                                                                                                 |

### The demo salon

`pnpm seed` builds **Aurora Hair Studio**: 2 locations in different timezones,
12 services with real phase chains, 6 staff with divergent skills and pace, 40
clients with hair profiles, 120 completed appointments with matching
quote-accuracy rows so calibration and analytics have genuine inputs, a
consultation template with conditional logic, reminder schedules, and consent
form placeholders. A second salon (**Bloom**) exists so tenant isolation is
visible rather than theoretical.

Every account uses password `salon1234`:
`owner@aurora.test` · `manager@aurora.test` · `frontdesk@aurora.test` ·
`rowan@aurora.test` · `client@aurora.test`

---

## What each workstream ended up being

| Workstream            | What it covers                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **W4** Catalog        | `catalog.ts` as the single mapping from a stored service to the scheduler's chain spec and the engine's fact spec; the phase editor, which shows what each chain frees up      |
| **W7** Client portal  | Guided consultation (one section per screen, client-side branching, autosave), photo capture scaled to the basket, inspiration tagging, plan review, slot picker, booking      |
| **W8** Stylist review | Queue ordered by urgency rather than arrival; review screen with the stylist-facing detail; flag acknowledge/resolve/override with a mandatory reason; decision with overrides |
| **W9** Front desk     | The day grouped by what needs doing, with "running late" computed rather than stored; client search; the diary drawing processing gaps as free time; the till                  |
| **W10** Commerce      | Deposits, invoices, payments, refunds and cancellation fees — all money math pure and in one place, all policies snapshotted, all provider calls idempotent                    |
| **W11** Compliance    | Patch tests with a 48-hour read gate, forms hashed at signing and verifiable afterwards, dated consent grants, export, and erasure that keeps the books                        |
| **W13** AI            | Eight call sites, all advisory, all redacted, all recorded, none used until a named person accepts them; photo analysis behind a second opt-in                                 |
| **W14** Day-of        | A state machine over four separate timestamps, because chair time is the only honest input to calibration                                                                      |
| **W15** Analytics     | Quote accuracy first, per stylist; funnel that names the biggest drop; utilisation against days actually worked; which rules people override                                   |
| **W16** Integrations  | Per-stylist subscribable calendar feed (hashed token, shown once, initials only), two-way sync and webhooks off the job queue                                                  |

---

## What a salon would still want

Everything below is real work that was out of scope rather than half-finished.
Nothing here is a stub pretending to be a feature.

| Area                      | State                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| OAuth flows               | The calendar port and connection model are built and the feed works. Actually authorising a Google account needs the consent screen dance. |
| Subscription billing      | The plan catalogue, feature gates and Stripe adapter exist. Nobody charges the salon yet.                                                  |
| Loyalty, packages, retail | Schema and relations exist and are enforced. No services or screens.                                                                       |
| Messaging inbox           | Threads, templates and the send path work. There is no two-way conversation view.                                                          |
| Waitlist offers           | Matching runs as a job. Offering a freed slot to a client is not surfaced.                                                                 |
| Legal copy                | Every shipped form is marked `isLegalPlaceholder` and the UI says so. They need an actual lawyer.                                          |

## Known limits worth stating

- **RLS is inert in development and CI.** Postgres superusers bypass row-level
  security, and the local and CI databases both connect as one. The policies
  are real and applied; they simply cannot be proven by the test suite as it
  stands. The tenancy tests exercise the application layer, which is what
  actually runs in production too.
- **Utilisation is approximate.** It divides chair time by days each stylist
  had any segment at all, at eight hours a day. The exact answer needs working
  hours minus time off, which is a heavier query than the screen justifies.
- **Photo quality is mechanical.** Resolution and compression, from the file
  header. Whether the lighting is any good is the AI port's job, and it is off
  by default.
