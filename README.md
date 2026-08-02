# Hair Salon Intelligence Platform

A consultation-first operating system for hair salons.

Most salon software books appointments well. None of it decides whether the
requested service is _realistic_ for that client's hair. So clients book the
wrong service, stylists arrive without history, consultations vary by stylist,
and the salon absorbs the cost in overtime, corrections and lost chair hours.

This platform inverts the flow — **consult first, then book, and only into slots
that actually fit** — and keeps a permanent hair record that compounds in value
every visit.

---

## Quick start

Everything runs with **zero API keys**. Every integration resolves to a mock
adapter by default.

```bash
pnpm install
pnpm db:up                  # starts the local PostgreSQL 16 cluster, creates the databases
cp .env.example .env        # mock adapters, no credentials needed
pnpm exec prisma migrate deploy
pnpm seed                   # Aurora Hair Studio, with a live day and a review queue
pnpm dev                    # http://localhost:3000
```

Sign in at `/login` — every seeded account uses password `salon1234`.

**As `client@aurora.test`:**

| Route                      | What it is                                                |
| -------------------------- | --------------------------------------------------------- |
| `/s/aurora/my`             | Next appointment, plans ready to book, open consultations |
| `/s/aurora/my/consult/new` | Pick services and start a consultation                    |
| `/s/aurora/my/timeline`    | Every chemical event on their hair, in order              |

A cut consults, auto-approves and books with nobody in the middle. A balayage
with box dye and a level-9 goal raises flags, plans two visits, and waits for
a stylist — which is the whole product in two journeys.

**As `owner@aurora.test`:**

| Route                          | What it is                                                      |
| ------------------------------ | --------------------------------------------------------------- |
| `/s/aurora/desk`               | Today, grouped by what needs doing. Running late comes first    |
| `/s/aurora/desk/calendar`      | The diary by stylist, with processing gaps drawn in gold        |
| `/s/aurora/review`             | Consultations to review, ordered by urgency rather than arrival |
| `/s/aurora/insights`           | Whether the quotes were true, per stylist                       |
| `/s/aurora/admin/services`     | The phase editor — where a service's real shape is declared     |
| `/s/aurora/admin/integrations` | Calendar feeds and connected accounts                           |
| `/design-system`               | Living reference for the salon design system                    |

### Checks

```bash
pnpm typecheck
pnpm lint
pnpm check:boundary     # server components must not call client-module helpers
pnpm test:unit          # domain logic + design tokens. No database.
pnpm test:integration   # repositories, tenant isolation, booking races, money.
pnpm test:e2e           # Playwright against a production build on mock adapters
pnpm build
```

`pnpm verify` runs everything except e2e.

### Looking at it without clicking through it

```bash
pnpm build && pnpm start -p 3100   # in one shell
SHOT_OUT=screenshots pnpm shots    # in another
```

Signs in as the seeded client and owner and captures every screen — desktop and
phone — against the production build. Useful for reviewing the product's
presentation in one pass; three real defects were found this way that no
assertion had covered.

---

## How it is put together

```
src/
  domain/      PURE. No Prisma, no Next.js, no React, no I/O.
               The rules engine, authorization policy, scheduling maths.
               ESLint forbids the imports that would compromise this.
  server/      Impure. Prisma, request context, services, jobs.
  ports/       One interface per integration, with a mock and a real adapter.
  app/         Next.js App Router. Thin — delegates to server/.
  components/  Themed UI primitives and salon-specific components.
prisma/schema/ Schema split by domain, plus hand-written migrations for the
               things Prisma cannot express.
```

The important boundary is `src/domain`. The part of the product that must be
provably correct — whether a service is safe, how long it takes, what it costs —
has no framework in it and no database behind it. It is a pure function of a
frozen fact snapshot, which is what makes it fast to test and auditable years
later.

### Two decisions worth knowing about

**Appointments are sequences, not blocks.** `AppointmentSegment` models an
appointment as buffer → active → processing → active. A processing segment
carries `blocksStylist = false`, so it never enters a stylist's busy set. That
is what allows a colourist to take another client during colour processing —
the behaviour falls out of the data model rather than being special-cased.

**Double-booking is impossible, not unlikely.** Postgres exclusion constraints
over a generated `tstzrange` reject overlapping segments. Holds live in the same
table as confirmed bookings, so a hold genuinely reserves the slot. Verified
behaviour:

| Case                              | Result   |
| --------------------------------- | -------- |
| Overlapping active bookings       | rejected |
| Overlapping hold                  | rejected |
| Back-to-back bookings             | accepted |
| Processing overlap (interleaving) | accepted |
| Expired/released hold overlap     | accepted |

---

## The consultation engine

`src/domain/consultation` is the differentiator. It takes a normalised
`ConsultationFacts` snapshot and returns risk flags, a complexity score, a
duration estimate with a breakdown, a deposit band, required pre-steps and a
multi-session plan.

- **Rules are versioned TypeScript**, not a config language. Salons get toggles
  and table values; they do not author logic. A published ruleset directory is
  immutable — behaviour changes copy forward to a new version, so a consultation
  approved last spring still evaluates to exactly what the stylist saw.
- **Every flag carries a recommended path.** The type system requires it. A flag
  that only refuses is a flag stylists learn to click past.
- **Outcomes combine commutatively**, so rule order cannot change the result and
  a new rule cannot alter an existing one's behaviour.
- **Determinism is tested**, including hash stability under key reordering and
  identical output across a reversed ruleset.

See [`docs/RULES.md`](docs/RULES.md) for the catalogue.

---

## AI

The model is structurally excluded from the deterministic path. It summarises
consultations, describes photos, explains flags that have _already_ fired, and
drafts messages. It cannot create or suppress a risk flag, and nothing it
produces takes effect without a human action. Every AI element in the UI is
visibly advisory.

With `AI_ENABLED=false` the entire product still works on templates.

---

## Adapters

| Port     | Mock (default)            | Real            |
| -------- | ------------------------- | --------------- |
| payments | in-memory intents         | Stripe          |
| sms      | `DevOutbox` table         | Twilio          |
| email    | `DevOutbox` table         | Resend          |
| storage  | local `./.uploads`        | S3 / R2         |
| ai       | deterministic fixtures    | Anthropic       |
| calendar | in-memory sync log        | Google Calendar |
| esign    | rendered signature + hash | DocuSign        |

Select with `ADAPTER_MODE=mock|real`, or per port (`PAYMENTS_ADAPTER=real`).

---

## Tenancy

Isolation is structural, in layers:

1. `dbFor(salonId)` — a Prisma extension injecting `salonId` into every filter
   and stamping it onto every write. A mismatched explicit `salonId` throws
   rather than being silently corrected.
2. The repository layer — raw Prisma is exported only as `unsafeDb` and is
   lint-restricted.
3. Row-level security policies on every table carrying a `salonId`.

A test walks the Prisma DMMF and fails if any model is neither registered global
nor carries `salonId`, so a model added later cannot skip the decision.

> **RLS caveat:** Postgres superusers bypass RLS, and dev/CI connect as
> `postgres`, so the policies are present but inert there. Run
> `scripts/sql/app-role.sql` and point `DATABASE_URL` at the non-superuser role
> to make RLS a genuine third barrier in a real deployment.

---

## Compliance

Consent and waiver templates ship as **clearly-labelled non-legal placeholders**
(`isLegalPlaceholder = true`). The platform manages storage, versioning,
signature capture and audit. The wording must be drafted and reviewed by a
qualified attorney for the jurisdictions the salon operates in. See
[`docs/COMPLIANCE.md`](docs/COMPLIANCE.md).

---

## Status

See [`docs/STATUS.md`](docs/STATUS.md) for what is built and what is not.
