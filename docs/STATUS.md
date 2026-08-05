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

Counts: **589 unit**, **170 integration**, **70 end-to-end**.

---

## The build-out, phase by phase

The 18 workstreams got the product working. These phases are the program that
followed, in dependency order. Each ends green on `pnpm verify` plus
`pnpm build && pnpm test:e2e`.

| Phase                            | What landed                                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P0** Fixes and reconciliations | 12-hour clock in the diary gutter; reference pictures removable; back buttons across the client flow; client and per-visit notes; the two interleave thresholds reconciled so the phase editor stops advertising gaps the solver refuses               |
| **P1** Four primitives           | `withPublicAction` (a mutation path with no tenant context); a notification materialiser keyed on any trigger, which made the long-dead consultation nudge start working; the admin settings shell; white-label branding that cannot break AA contrast |
| **P2** People can get in         | Front-desk "add client"; self-signup on the salon's own link plus a join code; walk-in claim; consent written at both doors; the approval notice; `notesToClient` surfaced to the client it was written for                                            |
| **P3** The right questions       | Service-scoped consultation forms; first-visit photos; availability narrowing at approval, sharing one filter with the waitlist; reference pictures measured against the hair under them                                                               |
| **P4** Money at the chair        | Ad-hoc invoice lines; editable prices; an owner-written discount catalogue with a real cap and an escalation path; gift cards on a ledger; and one authority for what a deposit costs                                                                  |

### What P4 changed, specifically

- **Commerce decides what money is.** Two `computeDeposit` implementations
  existed. The rules engine computed a figure from percentages hardcoded in
  its own file and that figure was persisted onto `ServicePlan`; the till
  computed a different one from the salon's actual policy row. Nothing mapped
  between them — one band is `0|1|2|3`, the other a string — so a client could
  be quoted one number and asked for another with neither side knowing. The
  engine now returns a band and nothing else. `Service.depositPolicyId`, in
  the schema since it was written with zero references in `src/`, is finally
  read; a chemical service at a salon that has configured nothing takes a $50
  floor; and the risk band may raise the figure, never lower it.
- **The till can change a bill.** `extraLines` was accepted by `buildInvoice`
  and hidden by the action's schema. Lines can now be added and prices edited,
  and a price edited _below_ what the client agreed counts toward the discount
  cap — otherwise "edit the line to zero" is an unlimited discount with none
  of the checks.
- **A discount has a reason.** A typed catalogue the owner writes, a dropdown
  at the till, and the amount computed server-side from the catalogue row —
  a till that could post its own total could post any total. Over the cap is
  an escalation with a written reason rather than a refusal, on the
  `discount.applyOverCap` action that had been in the role matrix since it was
  written and was held by nothing.
- **Gift cards settle rather than discount.** Sold as a line, spent as a
  payment. A card was revenue when it was bought; spending it is settlement,
  and recording it as a negative line would count the same money twice. The
  balance is the sum of an append-only ledger, never a column — and it is read
  and spent under a row lock, because two tills reading a balance and then
  writing against it both see the full amount.
- **Four arithmetic defects in `computeInvoice`**, each reachable only once the
  till could touch a bill: a per-line discount larger than its line was
  reported at its full asking price; a fractional quantity produced fractional
  cents in a module whose first promise is integer cents; the per-line tax
  returned to the caller did not sum to the tax charged whenever an order
  discount scaled it; and a negative line was silently zeroed by its own
  clamp. All four now have tests.
- **`takeDepositAction` took the risk band from its caller.** Anyone holding
  `payment.take` could post `NONE` and be charged nothing. It reads the figure
  frozen onto the plan — which is also the figure the client was shown.

### What P3 changed, specifically

- **A cut is no longer interrogated about box dye.**
  `ConsultationTemplate.appliesToServiceIds` had been in the schema since it
  was written and was read by nothing, so every basket got the salon's single
  published form. Resolution is strictest-service-wins, mirroring
  `requiredPhotoViews`: a cut booked alongside a balayage gets the balayage
  form, because the risky service is the one being assessed. The seed now
  carries two forms — a colour one naming the colour services, and a general
  one naming nothing, which is what makes it the fallback.
- **A stranger is asked for their shape; a regular is not.** `photos.ts` used
  to require no photos at all for a non-chemical service. A regular's shape is
  on file from every previous visit; a first-timer's is not, and
  "shoulder-length bob" covers a range wide enough to lose forty minutes in.
- **A stylist can say "Tuesdays and Thursdays, mornings".** `ServicePlan`
  gained `WaitlistEntry`'s five window columns verbatim, so
  `domain/scheduling/window.ts` reads both with one filter — two models
  describing the same idea differently is how a client ends up offered a day
  they ruled out. The window bounds the _start_, not the finish; bounding the
  finish would return nothing for exactly the long services this exists to
  control. It comes off the plan, never off the request, so a client's own
  search cannot widen it back out, and `resolveSlot` applies it too — the slot
  token is unsigned, so that is the step that actually enforces it.
- **A reference picture is measured against the hair under it.** Tagging a
  reference with "the overall level" now opens the shade chart instead of
  storing a bare yes, and the gap is shown at upload — while the client can
  still act on it, rather than in the chair on the day. It reports distance and
  never a number of visits: that is the rules engine's answer, and a second
  threshold would eventually disagree with it.
- **Two defects found on the way.** The booking action validated
  `earliestMin`/`latestMin` as minutes-of-day while the solver read them as
  absolute epoch minutes; nothing passed them, so the disagreement never fired.
  They are now `notBeforeMin`/`notAfterMin`, which is what the multi-session
  planner actually meant by them. And the diary drew a fixed 7am–9pm window
  with a comment claiming there was nothing outside it to see — an early or
  late appointment was drawn nowhere at all, which a front desk reads as a free
  stylist.

---

## Built and tested

|                            | What it covers                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W0** Foundation          | Next.js 15 + TS strict, the salon design system (white/blue/gold with rose for the colour work, black text, Plus Jakarta Sans over Inter), `/design-system`, WCAG AA contrast test that caught two real failures in the palette |
| **W1** Data model          | 99 models; GiST exclusion constraints proving overlapping bookings and holds are rejected while back-to-back and processing overlap are accepted; RLS on every tenant table                                                     |
| **W2** Tenancy & authz     | 60-action × 5-role matrix, `dbFor()` scoping extension, `withAuthz` as the single mutation path, DMMF test that fails if a model skips the tenancy decision                                                                     |
| **W3** Ports & adapters    | Seven ports, mock + real, one shared contract suite. EXIF stripping, payment idempotency, PII refusal on the AI port                                                                                                            |
| **W5** Scheduling          | Pure interval solver with phase chains, interleaving, resource assignment and gap-fill ranking; DST across four zones; 25-way concurrent booking race proven safe                                                               |
| **W6** Consultation engine | 17 rules, deterministic and versioned; every flag carries a recommended path; order-independence proven against a reversed ruleset                                                                                              |
| **W12** Jobs               | Postgres queue with `FOR UPDATE SKIP LOCKED`, long-lived worker, outbox dispatch, reminders, hold expiry, waitlist matching, calibration                                                                                        |
| **W17** Seed & e2e         | Deterministic Aurora Hair Studio demo; Playwright suite against a production build                                                                                                                                              |

### The demo salon

`pnpm seed` builds **Aurora Hair Studio**: 2 locations in different timezones,
12 services with real phase chains, 6 staff with divergent skills and pace, 40
clients with hair profiles, 120 completed appointments with matching
quote-accuracy rows so calibration and analytics have genuine inputs, two
consultation forms (a colour one with conditional logic and a general one for
everything else), reminder schedules, and consent form placeholders. A second
salon (**Bloom**) exists so tenant isolation is visible rather than theoretical.

The live day is placed relative to now but clamped to the salon's own local
date. Seeded a little after local midnight, "three hours ago" used to land on
yesterday and the whole day vanished from a front desk showing today — a demo
salon with nothing booked, which is the one thing that screen exists to
disprove.

Every account uses password `salon1234`:
`owner@aurora.test` · `manager@aurora.test` · `frontdesk@aurora.test` ·
`rowan@aurora.test` · `client@aurora.test`

---

## What each workstream ended up being

| Workstream            | What it covers                                                                                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W4** Catalog        | `catalog.ts` as the single mapping from a stored service to the scheduler's chain spec and the engine's fact spec; the phase editor, which shows what each chain frees up                                                              |
| **W7** Client portal  | Guided consultation (one section per screen, client-side branching, autosave), a shade chart of named colours by family, photo capture scaled to the basket, reference pictures as the closing step, plan review, slot picker, booking |
| **W8** Stylist review | Queue ordered by urgency rather than arrival; review screen with the stylist-facing detail; flag acknowledge/resolve/override with a mandatory reason; decision with overrides                                                         |
| **W9** Front desk     | The day grouped by what needs doing, with "running late" computed rather than stored; client search; the diary drawing processing gaps as free time; the till                                                                          |
| **W10** Commerce      | Deposits, invoices, payments, refunds and cancellation fees — all money math pure and in one place, all policies snapshotted, all provider calls idempotent                                                                            |
| **W11** Compliance    | Patch tests with a 48-hour read gate, forms hashed at signing and verifiable afterwards, dated consent grants, export, and erasure that keeps the books                                                                                |
| **W13** AI            | Eight call sites, all advisory, all redacted, all recorded, none used until a named person accepts them; photo analysis behind a second opt-in                                                                                         |
| **W14** Day-of        | A state machine over four separate timestamps, because chair time is the only honest input to calibration                                                                                                                              |
| **W15** Analytics     | Quote accuracy first, per stylist; funnel that names the biggest drop; utilisation against days actually worked; which rules people override                                                                                           |
| **W16** Integrations  | Per-stylist subscribable calendar feed (hashed token, shown once, initials only), two-way sync and webhooks off the job queue                                                                                                          |

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
