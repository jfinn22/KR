# Where this product should go next

A market-grounded assessment of what to build, ranked by leverage rather than
by how interesting it is to build. Research current as of August 2026; every
figure is sourced at the bottom.

The organising question is not "what features do salons want" — that list is
infinite and mostly already served. It is **"what can this product do that
Vagaro, Boulevard, Phorest, Fresha and Zenoti structurally cannot?"** Anything
that fails that test is parity work, and parity work against companies with
$80M in the bank is a losing trade.

---

## Part 1 — What the research says about the thesis

The core bet is that consultation, not booking, is the unsolved problem. The
market data supports that more strongly than expected.

| Finding                                                                    | Why it matters here                                                           |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Only 7% of salon clients say they receive a proper consultation**        | The problem is real, universal, and nobody has automated it                   |
| **96% of unhappy clients never complain; 91% never come back**             | The damage is invisible to the salon — they cannot fix what they cannot see   |
| **Salons have the highest no-show rate of any appointment business, ~30%** | On $400k revenue that is $60–80k/year, and mis-set expectations are a cause   |
| **Colour correction runs $150–$1,200**                                     | The cost of getting the consultation wrong is enormous and lands on the salon |
| **Colour clients retain at 75–85%, the best of any service**               | Roots grow. The recurring revenue is already there; it is under-systematised  |
| **67% of Gen Z have abandoned a salon over clunky booking**                | A better consultation only wins if the flow around it is faster, not slower   |

The unusual thing about this position: **the consultation engine is a genuine
technical moat.** A deterministic, versioned, order-independent ruleset with
frozen fact snapshots is not something a booking company adds in a sprint. It
took a workstream to build and it is auditable years later. Competitors can
copy a shade chart in a week. They cannot copy the engine without rebuilding
their data model.

Everything below is chosen to compound on that.

---

## Part 2 — The five highest-leverage things to build

Ranked. If only one gets built, build the first.

### 1. The achievability preview — show the client what they will actually get

**The single most valuable thing this product could produce.**

The engine already computes a multi-session plan: current level, target level,
how many visits, what happens in each. Right now the client reads that as
text. Instead, render it **on a photo of their own hair**:

> Here is your hair today (level 4). Here is the picture you sent (level 9
> platinum). Here is where you will actually be leaving after visit one
> (level 6, warm). Visit two (level 8). Visit three (level 9).

Every AR competitor — Perfect Corp, Banuba, L'Oréal's tools — shows the client
the fantasy. **None of them can show the honest intermediate, because none of
them have a rules engine that knows what is achievable in one sitting.** That
inversion is the whole product in one screen.

It attacks the exact failure the research identifies: clients bring reference
photos of a level 10 on a level 7 base, the stylist delivers a correct level 6,
and the client is quietly disappointed and never returns. Showing the honest
level-6 result _before_ they book converts that from a silent loss into a
managed expectation.

Build notes: goes through the AI port as an advisory, visibly-labelled render —
consistent with the existing boundary that AI cannot create or suppress a risk
flag. The _levels_ come from the deterministic engine; only the pixels come
from the model.

### 2. Reference-picture analysis at upload time

The consultation now closes on reference pictures. Right now they are stored.
Make them **argue back, immediately**:

> This photo is roughly a level 10 cool platinum. Your natural is level 4.
> That is a three-visit journey, not a single appointment — here is what
> visit one looks like.

This runs the moment the client uploads, while they are still in the flow and
still emotionally flexible. Doing it later — in the salon, in the chair — is
where the argument happens. The AI port already describes photos; this is
wiring an existing capability to the moment where it changes an outcome.

### 3. Surface waitlist offers

Already built as a matching job. Not surfaced to anyone.

Salons using automated waitlist offers **fill 60–80% of last-minute
cancellations within hours.** This is the highest ratio of revenue to
engineering effort in the entire backlog — the hard part (matching against a
phase-chain-aware availability solver) is done. What is missing is a screen
and a notification.

### 4. Book the whole plan, not the next appointment

The engine plans three sessions with correct spacing. The client books one.

Two facts make this the strongest retention lever available:

- **If a first-time client has not rebooked within 30 days, their probability
  of returning drops to 20%.**
- Rebooking friction is the single biggest driver of retention, and within one
  salon rebook rates range **22% to 61% by stylist** — it is a process problem,
  not a talent problem.

Booking all three sessions at engine-computed intervals, in one flow, at the
moment of maximum commitment, removes the rebooking decision entirely. No
competitor can do this properly because none of them know that visit two must
be 6–8 weeks after visit one for the hair to tolerate it.

Extend to **standing cadence** for maintenance: "your roots need doing every 6
weeks — same stylist, same time, standing." Colour clients retain at 75–85%
precisely because the need recurs on a clock. Systematise the clock.

### 5. Colour formula and backbar cost capture

Vish, SalonScale and CLICS sell this as standalone products at $100+/month and
salons buy them. The hair timeline already stores chemical events — it is
missing weight and cost.

Three separate payoffs from one feature:

- **True margin per service.** Colour cost is the largest variable cost in a
  colour salon and most owners are guessing at it.
- **Better rules.** "Level 4 to level 7 took 60g of 20-vol over 45 minutes and
  landed warm" is a real training signal for the engine's lift predictions.
- **Reproducibility.** The stylist recreating a formula from six weeks ago is
  the most common thing a hair record is actually used for.

Bluetooth scale integration (the Vish model) is a natural port in the existing
adapter architecture.

---

## Part 3 — New methods for the consultation itself

Beyond the five above.

**Async video consultation for flagged cases.** When the engine says "better
seen in person," that currently ends the booking. Offer a middle path: the
client records 30 seconds of their hair in daylight, moving, and the stylist
reviews it on their own time. Converts a refused booking into a booked one
without spending a chair hour on a consult that might not convert.

**Structured strand and porosity capture.** The physical test a colourist
already performs, entered as structured data rather than a free-text note.
Feeds the engine directly and is the highest-quality input it could receive.

**In-chair consultation mode.** A stylist-facing version of the same flow for
walk-ins and phone bookings, so the record is identical regardless of how the
client arrived. Without this there are two classes of client and the analytics
lie.

**The handoff card.** One screen the stylist reads in the ninety seconds before
the client sits down: what they asked for, what was flagged, what was agreed,
what happened last time, what to say. This is the artefact that makes the whole
consultation visible at the moment it matters. Cheap to build, disproportionate
effect on whether stylists trust the system.

**Capture coaching.** Photo quality is currently assessed mechanically after
upload. Coach the retake _at_ capture — "step towards the window, we cannot
read your tone in this light" — because a bad photo produces a bad plan and
nobody re-uploads voluntarily.

**Paid consultations for corrective work.** Salons charge $50–75, credited
against the service, to filter price-shoppers and protect diagnostic time. The
engine already identifies exactly which consultations are corrective. Charge
for those automatically.

---

## Part 4 — New methods for booking

**Conversational booking that actually consults.** 35–40% of salon calls go
unanswered, and **69% of clients have abandoned a booking because they could
not reach a human.** A dozen AI-receptionist products now serve this. The
differentiated version here is not "an AI that books" — it is **an AI that runs
the consultation over text and hands a completed, engine-evaluated fact
snapshot to the salon.** That is defensible; taking a booking is not.

**Deposit tiering by computed risk.** Deposits reduce no-shows **40–60%**. The
engine already produces a deposit band. Make the band do real work: a trim
takes none, a corrective colour takes 50% and non-refundable inside 72 hours.
Risk-based rather than blanket, so low-risk clients are not taxed for the
behaviour of high-risk ones.

**Processing-gap fill.** The solver already models processing segments as
non-blocking. Surface it as an offer: "Rowan has a 40-minute processing gap at
2pm — a blow-dry fits." This turns a structural advantage of the data model
into revenue.

**Off-peak pricing suggestions.** Context-aware pricing has shown **22–25%
improvements in chair utilisation.** The analytics already compute utilisation.
Suggest, do not impose — salons are rightly nervous about surge pricing their
regulars.

---

## Part 5 — Revenue features worth building

**Memberships / colour club.** Only **15% of hair and nail salons offer
memberships, against 50% of medspas** — and salons with memberships grew
revenue **8% versus 2%**, a 4× difference. The schema partly exists. A colour
maintenance membership is the most natural fit in the entire industry because
the need genuinely recurs on a fixed clock.

**Aftercare attached to the plan, not the till.** Most salons run **3–5% retail
attachment against a 10–15% benchmark and a 28–35% top decile.** The reason
retail fails is that it is a sales pitch at the register. Here it is not: the
engine knows the service was a lightening, knows the hair was flagged fragile,
and can put a bond builder in the plan as **aftercare, before the appointment**,
with a reason attached. Every point of attachment is worth $8–12 per
appointment.

**Rebook rate per stylist.** The analytics already do quote accuracy per
stylist. Rebook rate is the same shape and the spread within one salon is
22–61% — which means it is coachable, and salons cannot coach what they cannot
see.

---

## Part 6 — Retention features worth building

**The 30-day first-timer intervention.** A new client who has not rebooked in
30 days is down to a 20% chance of ever returning. That is a hard deadline the
system can see and the salon cannot. Escalating, personal, and it stops at 30
days — after that it is spam.

**Silent-dissatisfaction detection.** 96% of unhappy clients never complain and
91% of those leave forever. A single check-in at 72 hours — after the colour
has been washed twice and settled, which is when disappointment actually
arrives — catches the fixable ones while a redo is still cheap and still
generous rather than defensive.

**Fade and regrowth prediction.** The timeline knows what was applied, at what
volume, and when. Predicting when a gloss will have faded or roots will show is
straightforward from that, and it is a far better reason to contact someone
than a generic "we miss you."

---

## Part 7 — Longer-term, defensibility

**The portable hair passport.** Let the client own their record and take it to
a new salon. This sounds like giving away the moat and is the opposite: it makes
this the format everyone else has to read, and a client who moves cities arrives
somewhere new already carrying a complete history. Network effects in salon
software are otherwise near-zero.

**Anonymised cross-salon benchmarking.** "Your quote accuracy sits in the 60th
percentile; your corrective-colour rate is double the median." Only possible
with a deterministic engine producing comparable outputs across tenants — which
is exactly what this architecture already guarantees.

**Brand-authored rulesets.** Wella, Redken and Olaplex all publish
lightening guidance nobody follows consistently. A versioned, immutable ruleset
directory is the natural home for it — and a manufacturer-endorsed rule pack is
a distribution channel, not just a feature.

**Insurance as go-to-market.** Patch tests are legally required before colour
in the UK, PPD allergy affects ~0.8% of the population, and **skipping a patch
test can void a salon's insurance.** This platform already enforces a 48-hour
patch-test gate with timestamped, hash-verified records — precisely the
evidence an insurer wants. A premium discount negotiated with a carrier is a
genuinely novel acquisition channel and turns a compliance feature into a
reason to switch.

---

## Part 8 — What not to build

Discipline here matters more than the roadmap.

| Do not build                     | Why                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Full POS, payroll, tax**       | Vagaro and Zenoti own this. Enormous surface area, low margin, and losing on it does not lose the deal   |
| **A consumer marketplace**       | Fresha and Booksy own discovery. Brutal economics and it puts you in competition with your own customers |
| **Generic marketing automation** | Phorest's entire identity. Winning here requires out-executing a company that does nothing else          |
| **Full inventory management**    | Track colour because it feeds the engine. Do not track towels                                            |
| **A generic AI chatbot**         | A dozen vendors ship this. Only worth doing if it runs the consultation                                  |

The pattern: build what the consultation engine makes uniquely possible, and
integrate everything else.

---

## Part 9 — Suggested sequencing

**Now — finish what exists.** Waitlist offers surfaced, book-the-whole-plan,
the handoff card, rebook rate per stylist. All four are small, all four use
machinery that already works, and together they make the existing product
visibly better rather than bigger.

**Next — the differentiator nobody can copy.** Reference-picture analysis at
upload, then the achievability preview. This is the demo that wins deals and it
is the reason the engine exists.

**Then — revenue.** Memberships, aftercare in the plan, colour formula and cost
capture, risk-tiered deposits.

**Later — the moat.** Portable records, cross-salon benchmarking, brand
rulesets, the insurance channel.

One caution on ordering: the achievability preview is the most exciting thing
on this list and the most tempting to do first. It is worth substantially more
_after_ waitlist offers and plan-booking exist, because those are what make the
salon's day measurably better in week one. A product that dazzles in the demo
and does not change Tuesday gets churned.

---

## Sources

Market and competitive landscape:
[Zenoti — best salon software 2026](https://www.zenoti.com/thecheckin/best-salon-management-software-2026) ·
[The Salon Business — software guide](https://thesalonbusiness.com/best-salon-software/) ·
[Mordor Intelligence — salon software market](https://www.mordorintelligence.com/industry-reports/salon-software-market) ·
[Grand View Research — spa & salon software](https://www.grandviewresearch.com/industry-analysis/spa-salon-software-report)

Consultation, retention and rebooking:
[Zylu — client retention benchmarks](https://zylu.co/client-retention-benchmarks-salons/) ·
[Jeri Commerce — retention statistics](https://blog.jericommerce.com/resources/spas-salons-medspas-retention-statistics) ·
[MioSalon — dissatisfied clients](https://blog.miosalon.com/ways-to-identify-dissatisfied-clients-at-a-salon-and-how-to-deal-with-them/) ·
[Salon Magazine — colour services gone wrong](https://www.salonmagazine.ca/how-to-manage-client-satisfaction-for-colour-services-gone-wrong/)

No-shows and deposits:
[NoShowCost — the 30% rate problem](https://noshowcost.com/salons) ·
[SchedulingKit — deposit statistics](https://schedulingkit.com/statistics/appointment-deposit-statistics) ·
[BookingBee — reducing no-shows](https://bookingbee.ai/reduce-salon-no-shows/)

AI, AR and scheduling technology:
[Perfect Corp — live hair colour](https://www.perfectcorp.com/business/products/live-hair-color) ·
[Banuba — AR hair colour apps](https://www.banuba.com/blog/best-ar-hair-color-apps) ·
[eOxys — AI in salon booking apps 2026](https://eoxysit.com/blogs/ai-in-salon-beauty-booking-apps-2026-from-schedules-to-fully-smart-experiences/) ·
[CloudTalk — AI receptionists for salons](https://www.cloudtalk.io/blog/best-ai-receptionist-for-salons-spas/)

Colour formula and backbar:
[Vish](https://getvish.com/) · [SalonScale](https://www.salonscale.com/product) ·
[CLICS](https://www.clics.com/watch-a-demo/) ·
[Zenoti — inventory management](https://www.zenoti.com/salon-management-software/inventory-management)

Memberships and retail:
[Zenoti — packages and memberships](https://www.zenoti.com/thecheckin/salon-service-packages-pricing) ·
[Dall Italia — retail attach benchmarks](https://dallitalia.com/blogs/news/salon-retail-attach-rate-benchmarks) ·
[Mirellé — retail attach rate](https://mirelleinspo.com/trend-reports/retail-attach-rate-salon-revenue)

Compliance and liability:
[SalonIQ — patch test management 2026](https://www.saloniq.com/advice/salon-patch-test-management-software-the-2026-guide-to-safety-compliance/) ·
[Salon Services — patch testing guide](https://www.salon-services.com/blogs/article?cid=All-you-need-to-know-about-patch-tests-and-strand-tests-for-your-hair-and-beauty-clients&fdid=blog)

Demographics and business models:
[Boulevard — Gen Z consumer survey](https://markets.financialcontent.com/dowtheoryletters/article/bizwire-2025-11-6-boulevard-consumer-survey-shows-gen-z-and-millennials-redefining-the-self-care-client-experience) ·
[DaySmart — 2026 salon trends](https://www.daysmart.com/salon/blog/6-data-driven-salon-business-trends-for-2026/) ·
[Free Salon Education — booth rental vs commission](https://freesaloneducation.com/blogs/business/the-booth-rental-vs-commission-math-is-changing-in-2026)
