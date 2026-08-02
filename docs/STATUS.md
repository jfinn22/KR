# Build status

An honest account of what exists and what does not. The plan is 17
workstreams; this records where the line sits.

## CI

All three jobs green:

| Job           | Runs                                                                |
| ------------- | ------------------------------------------------------------------- |
| `static`      | typecheck, lint, format:check, unit tests, adapter contracts        |
| `integration` | migrations + tenant isolation + booking race, against real Postgres |
| `e2e`         | seed + Playwright against a production build on mock adapters       |

The e2e job was previously gated `if: false` because it had nothing to run, and
`verify:adapters` pointed at a directory that did not exist. Both are fixed by
the workstreams below rather than by weakening the checks.

Counts: **296 unit**, **36 integration**, **14 end-to-end**.

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

## Not built

The schema, permission actions, plan features and domain logic for these exist.
What is missing is the **user interface** and the services that sit behind it.

| Workstream           | State                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| W4 Service catalog   | Schema, phase chains and modifiers exist and are used by the solver. No admin UI.                                          |
| W7 Client portal     | Not built. The consultation engine, availability solver and booking transaction it would call are all complete and tested. |
| W8 Stylist dashboard | Not built. Review/approve logic is expressible today via `withAuthz` + `evaluate()`.                                       |
| W9 Front desk        | Not built. Holds, waitlist matching and cancellation are implemented server-side.                                          |
| W10 Commerce         | Payments port, deposits and the schema exist. Invoicing, refunds and subscription billing services are not written.        |
| W11 Compliance       | Schema, form placeholders and the e-sign port exist. Signing flows are not built.                                          |
| W13 AI layer         | Port, prompts, mock and Anthropic adapters exist. The eight call sites are not wired to services.                          |
| W14 Day-of workflow  | `checkInToken` and the schema exist. Check-in and in-chair screens are not built.                                          |
| W15 Owner analytics  | Calibration is implemented and tested. Dashboards are not built.                                                           |
| W16 Integrations     | Calendar port and ICS builder exist. OAuth flows and export are not built.                                                 |

### Suggested order to continue

1. **W4 catalog UI** — the phase editor is where a salon declares that balayage
   is 90 active / 40 processing / 45 active, which everything downstream reads.
2. **W7 client portal** then **W8 review workspace** — closes the
   consult → approve → book loop end to end, at which point the product is
   demonstrable to a salon.
3. Everything after that is conventional salon software.

The differentiated core — the rules engine and the availability solver — is
done, tested, and proven against a real database.
