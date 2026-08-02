# The consultation rules catalogue

Ruleset `v2026-01-01`. Source: `src/domain/consultation/rules/v2026-01-01/`.

Every rule returns a **recommended path**. That is enforced by the type system,
not by convention: a flag that only refuses is a flag stylists learn to click
past, and a salon whose staff ignore the flags is worse off than one with no
flags at all.

## Severity

| Severity  | Meaning                                                                    |
| --------- | -------------------------------------------------------------------------- |
| `INFO`    | Worth knowing. Never gates anything.                                       |
| `CAUTION` | Affects the plan, timing or price. Booking stays open.                     |
| `HIGH`    | Significant risk. Usually adds a pre-step and raises the deposit.          |
| `BLOCKER` | Online booking closes. The client is routed to a consult, not turned away. |

## Catalogue

| Rule                          | Fires when                                                                                              | Severity                              | Recommended path                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| `BOX_DYE_HIGH_LIFT`           | Box dye on the lengths, lift ≥ 3 levels                                                                 | HIGH / CAUTION                        | 2–3 staged sessions 6–8 weeks apart with a strand test first            |
| `HENNA_LIGHTENER_CONFLICT`    | Any henna history with a lightening service                                                             | BLOCKER if product unknown, else HIGH | Free 20-minute in-person incompatibility test on a cutting              |
| `BLACK_BOX_TO_PLATINUM`       | Dark box colour, target level ≥ 9                                                                       | BLOCKER                               | Three-session correction over ~4 months with bond building              |
| `EXTENSIONS_ON_FRAGILE_HAIR`  | Extensions with poor elasticity, breakage, low integrity, fine+low density, or ≥3 bleaches in 12 months | HIGH if ≥2 signals                    | Bond-repair programme, then reassess; or lighter method with fewer rows |
| `ALLERGY_OXIDATIVE_COLOUR`    | PPD allergy or prior colour reaction                                                                    | BLOCKER                               | Consult, PPD-free alternatives, supervised patch test 48h prior         |
| `PATCH_TEST_REQUIRED`         | Dye service with no valid patch test, or an active scalp condition                                      | HIGH if scalp affected, else CAUTION  | Five-minute patch test, book 48h+ later, preferred slot held 72h        |
| `COMPROMISED_INTEGRITY`       | Gumminess, breakage, severe split ends or poor elasticity before a chemical service                     | HIGH if ≥2 signals                    | Four-week strengthening course, then reassess                           |
| `RELAXER_PLUS_LIGHTENER`      | Relaxer or perm within 12 months plus lightening                                                        | BLOCKER within 6 months               | Wait for grow-out; gloss or lowlights meanwhile                         |
| `KERATIN_TIMING_CONFLICT`     | Smoothing treatment within 3 months                                                                     | CAUTION                               | Colour first, smooth after; or gloss now and colour later               |
| `GREY_COVERAGE_RESISTANT`     | ≥50% grey                                                                                               | INFO                                  | Coverage-weighted formula and extra processing time                     |
| `UNREALISTIC_SINGLE_SESSION`  | Lift ≥ 4 levels without a more specific rule firing                                                     | CAUTION                               | Split across two visits ~8 weeks apart                                  |
| `MINOR_REQUIRES_GUARDIAN`     | Minor, chemical service, no guardian consent on file                                                    | BLOCKER                               | Guardian signs from an emailed link; booking opens immediately          |
| `STYLIST_SKILL_BELOW_SERVICE` | Requested stylist not signed off for the service                                                        | CAUTION                               | Route to a specialist, or supervise                                     |
| `DEADLINE_TOO_TIGHT`          | Hard date within 90 days against a staged plan                                                          | HIGH under 6 weeks                    | Aim for an achievable version; book both sessions now                   |
| `MAINTENANCE_MISMATCH`        | Low upkeep appetite with a high-upkeep goal                                                             | INFO                                  | Root shadow or balayage placement that stretches to 12 weeks            |
| `SWIMMER_MINERAL_BUILDUP`     | Weekly chlorine or hard water                                                                           | INFO                                  | Chelating treatment at the start of the appointment                     |
| `INSUFFICIENT_PHOTOS`         | Required views missing or quality too low                                                               | CAUTION                               | Add the missing angles in daylight                                      |

`INSUFFICIENT_PHOTOS` is a `DATA_QUALITY` rule. It lowers estimate confidence
and never blocks — missing photos are a data problem, not a hair problem, and
must never read to a client as a refusal.

## Derived outputs

**Complexity** sums service base complexity and rule deltas, clamped 0–100.
Bands: SIMPLE < 20, MODERATE < 40, COMPLEX < 70, CORRECTIVE ≥ 70.

**Duration** = phase-chain base, scaled by length/density/texture on _scalable
phases only_ (processing time is chemistry, not hair volume), plus rule
additions, then rule multipliers in rule-id order, then stylist calibration.
Calibration is ignored below 5 samples and clamped to [0.8, 1.35].

**Deposit** takes the maximum band across complexity, severity, any rule floor,
multi-session plans, new clients on complex services, and repeat no-shows. The
band resolves to money through the salon's deposit policy, capped.

**Price** becomes a quoted _range_ when complexity ≥ 40 or severity is HIGH or
BLOCKER. Telling a client a service is risky and then quoting one confident
number contradicts itself.

## Adding or changing a rule

A published ruleset directory is **immutable**. To change behaviour:

1. Copy `rules/v2026-01-01/` to a new version directory.
2. Edit there and bump the version string.
3. Register it in `src/domain/consultation/registry.ts`.

Historical consultations keep evaluating against the version that produced the
decision their stylist actually approved.

Bump a rule's `version` field on any logic change — the ruleset hash folds it
in, so a silent edit to published behaviour is detectable.

## Why not a config language

Rules need arithmetic over level deltas, month windows and skill comparisons. A
JSON DSL expressive enough for that becomes an untyped programming language
with a hand-rolled interpreter: harder to test, harder to review, and
impossible to typecheck.

Explicability comes instead from three places: prose in each rule's `docs`
block, a mandatory `evidence` array so the UI can show exactly which facts
fired it, and the full input/output snapshot stored on `RuleEvaluation`.

Salons get **toggles** (`SalonRuleOverride`) and **table values** (service
modifiers, deposit bands) — never new logic.
