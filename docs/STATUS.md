# Build status

Honest account of what exists in this repository and what does not. The full
plan is 17 workstreams; this records where the line currently sits.

## Complete and tested

### W0 — Foundation and design system

Next.js 15 + TypeScript strict, Tailwind, pnpm, Vitest (unit + integration
projects), Playwright config, CI workflow, session-start hook.

The salon design system is fully specified: white/blue/gold with black text,
Cormorant Garamond display over Inter UI, hairline borders, near-invisible
shadows, gold used as a garnish rather than a fill. Colour tokens live once in
`globals.css` as RGB channel triplets so Tailwind alpha modifiers resolve, and
no component may hard-code a hex value. `/design-system` renders the reference.

`tests/unit/design/palette.test.ts` parses the real tokens and asserts WCAG AA
on every text/background pair. It caught two genuine failures during setup —
the amber `--warn` at 3.7:1 on white and `gold-600` at 3.5:1 — which is why
`--warn` is darkened and `gold-700` is now the only text-carrying gold rung.

`scripts/dev-db.sh` drives the system PostgreSQL 16 cluster directly rather than
Docker, because the CLI is present in this environment but the daemon is not.

### W1 — Data model

99 models across nine schema files. Tenancy, catalog with phase chains,
scheduling, consultation intelligence, hair record, commerce, communications,
compliance, operations.

A hand-written migration adds the generated `tstzrange` column, two GiST
exclusion constraints, the job-queue NOTIFY trigger, and row-level security on
every table carrying a `salonId`. Exclusion behaviour verified directly against
Postgres: overlapping bookings and overlapping holds rejected; back-to-back,
processing overlap and released holds accepted.

### W2 — Tenancy, auth, authorization

Auth.js v5 with credentials, `TenantContext` resolution, the `dbFor(salonId)`
Prisma extension, `withAuthz` as the single mutation path, audit logging.

A permission matrix over 60 actions and 5 staff roles, with clients and
background jobs as separate principal kinds rather than weak roles.

43 unit tests including a loop proving no role reaches another salon for any
action. 17 integration tests including a DMMF walk that fails if a model skips
the tenancy decision, and a `pg_catalog` query confirming RLS on every tenant
table.

### W6 — Consultation rules engine

17 rules, pure and deterministic. Complexity scoring, duration estimation with
a breakdown and stylist calibration, deposit banding, multi-session planning,
requirement dedup, consultation mode selection.

60 tests: positive and negative cases per rule, determinism across repeated
runs, hash stability under key reordering, ruleset-hash sensitivity to version
bumps, and order-independence proven against a reversed ruleset.

---

## Not yet built

These are designed — the data model, permission actions and plan features for
each already exist — but the code is not written.

| Workstream                               | State                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| W3 Ports & adapters                      | Interfaces designed, env resolution in `src/env.ts`; adapter implementations not written |
| W4 Service catalog                       | Schema complete; admin UI and services not written                                       |
| W5 Scheduling core & availability solver | Data model and DB constraints complete and verified; the solver itself is not written    |
| W7 Client portal                         | Not written                                                                              |
| W8 Stylist dashboard                     | Not written                                                                              |
| W9 Front desk dashboard                  | Not written                                                                              |
| W10 Commerce & policy                    | Schema complete; logic not written                                                       |
| W11 Consent & compliance                 | Schema complete; flows not written                                                       |
| W12 Jobs & automation                    | Job table and NOTIFY trigger exist; worker not written                                   |
| W13 AI layer                             | Port contract designed; adapters not written                                             |
| W14 Day-of workflow                      | Schema complete; screens not written                                                     |
| W15 Owner analytics                      | Schema complete; dashboards not written                                                  |
| W16 Integrations                         | Not written                                                                              |
| W17 Seed & docs                          | This document and the README exist; the demo seed does not                               |

`pnpm seed` and `pnpm test:e2e` are wired into `package.json` and CI but have no
implementation behind them yet, so CI's e2e job will fail until W17 lands.

---

## Suggested order to continue

The dependency spine from the plan still holds:

1. **W3 ports** — mock adapters unblock everything downstream and let the whole
   flow run without credentials.
2. **W5 availability solver** — pure domain code against the segment model that
   is already proven at the database layer.
3. **W4 catalog** then **W7 client portal** — the first user-visible slice.
4. **W8 review workspace** — closes the consult → approve → book loop, at which
   point the product is demonstrable end to end.

Everything after that is valuable but conventional salon software; the
differentiated core is W5 plus W6, and W6 is done.
