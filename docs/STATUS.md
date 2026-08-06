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
| **P5** Cards on file             | A card kept at the provider and never here; the deposit lifecycle made real, from owed through held, taken, spent or kept; a signed webhook that reconciles what the provider says; cancellations and no-shows that settle the money; paid corrective consultations, credited against the work |
| **P6** Filling the calendar      | A slot search with no plan behind it; one decision about when a consultation is actually needed, with an audited way past it; booking from the desk; the gold processing gaps made bookable; "come in and let me look at it" turned into an appointment the client picks; a waitlist that honours what people asked for and holds what it offers; and every visit of a plan booked in one pass |
| **P7** The differentiator        | The middle of the journey, drawn honestly — including the visits that leave somebody orange; a handoff card carrying everything the consultation found onto one screen; photo coaching that names the actual problem; consultations filled in with the client in the chair; and a short clip of the hair moving, for the assessments a still cannot serve |
| **P8** Retention and migration   | A salon's whole history brought across from the platform they are leaving, with one-operation undo; upcoming appointments booked for real rather than inserted, so a parallel run cannot cause the double-booking it exists to prevent; aftercare written at the chair with the reason attached; the clients a salon is quietly losing, listed while somebody can still ring them; a 72-hour check-in that is one tap from a text; and what the colour in the bowl actually cost |
| **P9** Memberships and billing   | Something a client pays for monthly and gets back every visit — applied at the till where they can watch it land; a lifecycle that survives an expired card, a plan change mid-period and a cancellation somebody has already paid past; and the platform's own subscription, which finally writes the columns it has carried since the first migration |

### What P9 changed, specifically

- **The ten schema models were the easy tenth.** `ClientMembership`,
  `ClientMembershipPlan` and eight relatives had described memberships since the
  beginning and nothing had ever created one. Almost all of the work is what
  happens AFTER the sale, because that is where a subscription business is
  either trustworthy or not.
- **Every ambiguous case is read the client's way.** They get the better of two
  benefits, not the cheaper. They keep the period they have already paid for
  when they cancel. A failed card gets three weeks before the membership ends,
  because most failures are an expired card on somebody who fully intends to
  keep paying. A salon that wins those arguments does not lose a subscription,
  it loses the client.
- **Benefits are applied at the till, visibly.** As a per-line discount rather
  than a lowered price, because a membership that silently reduces a bill reads
  as a pricing error to the person paying — and watching it work is the whole
  reason anybody keeps paying the fee. They deliberately do not count against
  the discount cap: an entitlement somebody bought is not a discretionary
  discount for the front desk to be limited on.
- **Uses are a ledger, not a counter.** Every running total in this platform has
  eventually been found wrong with nothing to check it against. Rows can be
  counted per period, an allowance resets without anybody sweeping, and a voided
  invoice gives its own use back.
- **Benefits stop at a week overdue; the membership ends at three.** A
  membership still giving away haircuts against a card that does not work is one
  the salon is paying for. Cancelling at the first decline is a client who has
  to be re-sold something they already wanted.
- **A plan change does not restart the period.** A client who upgrades on the
  20th has already paid to the end of the month, and resetting the clock charges
  a fresh period on top of the difference they just settled — the double-charge
  every subscription complaint is about. The proration is shown as both numbers
  it came from, because "£15 left on the old one, £25 for the rest of this one"
  is a conversation and "that will be £10" is a dispute.
- **A failed platform payment suspends nothing.** `requireFeature` reads the
  plan, not the payment state, and that separation is deliberate. A salon whose
  card expired still has clients arriving at nine tomorrow, and taking their
  diary away over it would cost them their day and this platform its reputation.
- **The platform's own till got a screen, because otherwise it had no door.**
  `startPlatformSubscription` wrote the columns `Subscription` has carried since
  the first migration — and nothing called it, so every salon stayed `TRIALING`
  forever exactly as before. `/admin/billing` is what calls it. It leads with
  the limits rather than the price: a salon that has grown to five stylists is
  told Starter allows one *before* they pick it, and by how much they are over,
  rather than after a save fails. Moving tier goes through a new
  `updateSubscription` on the payments port instead of cancel-and-recreate,
  which would end the period the salon has already bought and bill a fresh one
  on top — the same double-charge the client-side plan change refuses to make.

### What P8 changed, specifically

- **The first CSV is always wrong.** Everything in the migration track is built
  around that. Every row an import writes carries `importBatchId`, so undo is a
  walk over three foreign keys rather than a reconstruction — and it will not
  delete somebody who has come to depend on the row. A client who has signed in,
  booked outside the import, been consulted or been billed is kept and named in
  the result. An undo that eats a real Tuesday is a worse outcome than the one it
  exists to avoid.
- **The screen shows the work before it does any.** What each column was taken
  to mean, what could not be read and on which line, and the first few rows
  exactly as they came out. Mapping is one decision per distinct name, not per
  row: a salon with four thousand appointments has fourteen services, and asking
  on every line is how a migration gets abandoned at 3pm on a Tuesday.
- **Dates are the one question it refuses to answer for you.** A file of 03/04,
  05/06, 07/08 could be either way round and nothing in it settles which;
  guessing moves a salon's entire history by up to eleven months. Where the file
  proves itself — a 13th in the column — it is read without asking.
- **Two things an import must get right that stay invisible for months.**
  Imported formulas are dated from when the colour went on rather than when the
  row was written, because `createdAt` defaults to now() and that is the clock
  anything asking "how grown out is this" reads. And visit counters are computed
  from the imported history rather than left at zero: `completedVisits === 0` is
  how nine places in this platform ask "is this a new client", so a migrated
  salon would otherwise fire its new-client welcome at its entire book.
- **A live double-count, fixed.** `completedVisits` incremented on both
  `END_CHAIR` and `CHECK_OUT`, which is exactly the desk's normal two-tap
  sequence — so the counter roughly doubled at salons that used both buttons and
  was correct at salons that skipped straight to checkout. Wrong, and
  inconsistent between salons, and invisible because the only thing that read it
  asks `=== 0`.
- **A trigger with finished copy and no producer, wired.**
  `NotificationTrigger.APPOINTMENT_AFTER` has said "How is it sitting?" since the
  schema was written and nothing had ever created a row for it. It now carries a
  one-tap link — a link rather than a reply, because `MessageDirection.INBOUND`
  exists and nothing writes it, and a salon that asks a question it does not read
  has done worse than not asking.
- **The check-in never mutates on GET.** Message-app unfurlers and email
  security scanners fetch any URL they see; a check-in that consumed itself on
  page load would be answered by a robot before the client opened it. It is also
  rate-limited on the link rather than the caller's address, because a few
  hundred clients tapping from phones behind one carrier's egress IP would
  otherwise lock each other out — and be refused before the handler runs, so
  their answer is lost with no record it happened.
- **What the colour cost.** `ProductUsage` had grams, waste grams and a cost in
  cents since the beginning and nothing had ever written one. Waste is kept
  separate from spend because it is the only half a salon can change this week.

### What P7 changed, specifically

- **The middle of the journey.** Every competitor shows a before and an after.
  The middle is where the disappointment lives: a client going from a level 4
  brown to platinum is not shown three visits of orange, so the first time they
  see orange is in the mirror, halfway through, having paid for it. The ladder
  draws every stage, and marks the ones nobody finishes on — because gold at
  level 8 is exactly what is supposed to happen, and being surprised by it is
  the software's fault rather than the colourist's. Built from the underlying
  pigment chart, which is physics rather than a promise.
- **No generated imagery, deliberately.** A generated picture of *this
  client's* hair reads as a promise about their hair specifically, which is the
  one thing this product exists not to do — and it would need a new port,
  generated-asset storage, cost accounting and a liability story to say
  something less true than a row of swatches.
- **The handoff card.** A consultation is done once, by whoever was free,
  possibly six weeks earlier and possibly by somebody who is off that day. What
  they learned was spread across nine tables, so the stylist at the chair had
  none of it unless they went looking in nine places. They will not — they will
  ask the client, who will say "just a bit off the ends" and not mention the box
  dye. The ORDER of the screen is the design: what stops the appointment, then
  what was on the hair last time, then what they are asking for.
- **Photo coaching that says which problem.** The scorer produces five distinct
  issue codes and the capture grid rendered all of them as "too small or blurry
  to read" — true of one, unhelpful for three, and wrong for the one where the
  photo is neither small nor blurry. Somebody told "try another" takes the same
  photo again.
- **Consultations filled in with the client in the chair.** The flow always
  existed and only a client could start one, so a walk-in either got no
  consultation or got a link emailed to fill in later, at home, from memory.
  The person best placed to answer "how porous are the ends" is the one holding
  them. Recorded separately from `mode`, which the engine overwrites — this is a
  fact about how it happened, and a reviewer is entitled to know which kind of
  answers they are reading.
- **A clip of the hair moving.** `ConsultationMode.VIDEO` has been one of four
  modes since the schema was written and `pickMode` has had a branch returning
  it, with nowhere for the client to go once it did. Async on purpose: a live
  call needs scheduling, a provider and two people free at once, and it is worse
  at the job — a stylist watching a recording can scrub back to the frame where
  the light catches the banding, and on a call they can only ask again and hope.

### What P6 changed, specifically

- **A search that does not begin with a plan.** `bookDirect` took an arbitrary
  slot and chain, the loader was chain-generic, and the solver never knew what
  a `ServicePlan` was — the only missing piece was a way in. Staff booking,
  gap fill, waitlist matching and the import parallel-run all sit on the one
  function, so the four cannot drift.
- **When a consultation is actually required, decided once.** Not chemical and
  not marked as needing one: book it. Anything else: an approved plan, or a
  named person giving a written reason. Chemistry gates itself even with the
  checkbox left unticked, because a salon that adds a bleach service and
  forgets has not decided bleach is safe to book blind. A missing patch test
  refuses outright and the override does not reach it — that one is about
  somebody's scalp, not about paperwork.
- **Booking from the desk at all.** There was no staff booking flow, so a
  client ringing up for a trim on Thursday could not be put in the diary. The
  override, where it is needed, lands on the appointment's internal note —
  where the person holding the brush will see it, rather than only in an audit
  log nobody reads.
- **The gold blocks became clickable.** The diary has drawn processing gaps in
  gold and labelled them free since it was written, and nothing could be
  booked into one. Keyed on the segment id rather than a start and end time,
  because a window a browser can type is a window a browser can widen.
- **"Come in and let me look at it" produces an appointment.**
  `REQUEST_IN_PERSON` set a status and stopped: no invitation, nothing the
  client could act on. `NEEDS_IN_PERSON` was also missing from the client's
  open-consultation query, so the consultation simply vanished off their home
  page. Thirty minutes with the stylist who asked, at a time the client picks.
- **The waitlist honours what people said.** `dayOfWeekMask`, the two window
  minutes, `preferredStylistIds` and `serviceIds` had all been stored and
  never read, and there was no way onto the list from either side. The matcher
  compared the cancelled appointment's raw duration against
  `requiredDurationMin` — a different question from "does this client's chain
  fit here". It runs the real solver now, and an offer takes a real hold:
  an offer without one is a promise the salon cannot keep.
- **A plan can be booked whole.** `solveMultiSession` — a backtracking search
  over the gaps the engine computes between visits — had no callers. Booking
  visit one and hoping visit two exists in eight weeks is how a salon ends up
  with a half-finished blonde.

### What P5 changed, specifically

- **A deposit is now actually asked for.** `DepositStatus` had seven values
  and three were ever written — all at row creation, none by an update.
  `APPLIED`, `FORFEITED` and `REFUNDED` were unreachable, and
  `authorizationExpiresAt` and `appliedToPaymentId` were columns nothing
  touched. The lifecycle was a comment. It is a state machine now, and every
  transition that moves money either calls the provider first and records what
  it said, or is driven by a webhook.
- **A hold that was never held.** `takeDeposit` created a payment intent with
  no customer and no payment method behind it and marked the row `AUTHORIZED`
  on the strength of it — a hold nobody had agreed to, recorded as if they
  had, against a card that was never asked. Nothing was ever capturable. It
  now authorises off-session against a card on file, or leaves the row
  `PENDING` and hands the browser a client secret. A deposit is not taken
  until it is taken.
- **A PENDING deposit blocked its own charge.** `bookDirect` wrote a `PENDING`
  row at booking time; `takeDeposit` treated any live row as "already taken"
  and returned early. The row it had just written permanently prevented the
  charge it existed for.
- **Cancelling was free, whenever you did it.** `assessCancellation` had zero
  callers — so no cancellation ever produced a fee record and no no-show ever
  kept its deposit. Both routes to a no-show now settle it, and a deposit is
  kept only up to the fee: £50 held against a £30 late-cancel fee returns £20,
  because "the policy says 50%" is not a defence for taking more than 50%.
- **The bill and the money agree.** `buildInvoice` credited a held deposit
  through `paidCents` without ever capturing it — the salon handed over a
  discount and called it a deposit. Capture now happens before the credit is
  written, so a card that declines fails the checkout rather than producing an
  invoice short by the deposit; the row is marked `APPLIED` after, which is
  what stops the next bill crediting the same money again.
- **Holds do not silently lapse.** Providers drop an authorisation after about
  a week and a deposit taken six weeks out will outlive its own hold several
  times. A sweep renews them — cancelling the old hold before taking the new
  one, because two live holds on one card is what a client reads as being
  charged twice.
- **A corrective consultation can be charged for, and is credited.** Keyed on
  the engine's own `CORRECTIVE` band rather than a second definition of the
  word. Zero by default. Credited against the work booked from it, which is
  what keeps it from being a fee: you pay for the assessment only if you walk
  away.

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
| Loyalty, packages, retail | Schema and relations exist and are enforced. No services or screens.                                                                       |
| Messaging inbox           | Threads, templates and the send path work. There is no two-way conversation view.                                                          |
| Dunning the salon itself  | A failed platform payment moves the status and records an outbox event. Nobody has written the email that chases it.                      |
| Legal copy                | Every shipped form is marked `isLegalPlaceholder` and the UI says so. They need an actual lawyer.                                          |

## Known limits worth stating

- **RLS is inert in development and CI.** Postgres superusers bypass row-level
  security, and the local and CI databases both connect as one. The policies
  are real and applied; they simply cannot be proven by the test suite as it
  stands. The tenancy tests exercise the application layer, which is what
  actually runs in production too.
- **Utilisation is still approximate.** It divides chair time by the days each
  stylist had any segment at all, at eight hours a day. The exact answer needs
  working hours minus time off, which is a heavier query than the screen
  justifies. The day count itself is now made in the location's own timezone —
  it used to be UTC, which for any salon west of Greenwich rolled an evening
  appointment onto the next date, inflated the denominator and deflated the
  figure. Owners who have been tracking utilisation will see it move.
- **Fade and regrowth prediction is a model, not a measurement.** Every constant
  in `src/domain/hair/fade.ts` is a colourist's rule of thumb somebody should be
  able to argue with, which is why each one is named rather than buried in an
  expression. It refuses rather than guesses: with no date for the last colour
  it returns nothing and names what it would need, and it will not project
  forward from a colour more than a year old, because that is a fact about
  history rather than a basis for advice. Its four prerequisites were built
  alongside it — a `HairProfile` writer, `SALON_COLOR` and `TONER` in the
  history array, `BLEACH` carrying a real date instead of a hardcoded null, and
  a `monthsSinceOrNull` that can tell "we do not know" from "a long time ago".
- **Photo quality is mechanical.** Resolution and compression, from the file
  header. Whether the lighting is any good is the AI port's job, and it is off
  by default.
- **Cards need a provider account to be real.** With no
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` the card step falls back to the mock
  adapter, which is what keeps the whole booking journey runnable in dev and
  CI. The fallback calls `attachTestCard`, which the Stripe adapter does not
  implement — so configuring a real key makes it structurally unreachable
  rather than merely discouraged.
- **The journey ladder needs both ends levelled.** It draws nothing unless the
  client's own colour is known and their reference picture was tagged with a
  target. That is an ordinary case rather than an error — most references are
  never levelled — and the rest of the screen is unaffected.
- **Video carries no EXIF scrub.** The stripper runs on JPEG segments and does
  not apply to a video container, so `exifStripped` is recorded as false rather
  than claiming a pass that never happened. A clip's own metadata can carry
  location; nothing is marketing-approved automatically.
- **A waitlist offer blocks the slot.** Deliberately: an offer with no hold
  behind it is a promise the salon cannot keep, so the client drops what they
  are doing, taps accept, and finds it gone. The cost is that one slot is off
  the board for up to two hours while one person decides.
- **Deposits are held, not taken, until the day.** Manual capture throughout.
  That is deliberate, and it means a salon sees authorisations rather than
  settled funds in its provider dashboard until an appointment is invoiced or
  a no-show is recorded.
