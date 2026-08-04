# Switching platforms — import and cutover

Spec for letting a salon move onto this platform without re-entering years of
client history by hand, and without a day of dead calendars. Two problems,
handled separately because they fail differently:

1. **Data import** — get clients, appointment history, services and staff out
   of the old platform and into this one, mapped correctly.
2. **Cutover** — the weeks around the switch itself, where the old system and
   this one are both partly true at once.

---

## What the market actually does today

Checked before designing this, because "how do competitors solve it" bounds
what is realistic:

- **Vagaro ships importers _from_ Phorest and Fresha _into_ Vagaro** — the
  receiving platform does the parsing work, not the sending one. That is the
  right model and this spec follows it: never depend on the old platform's
  cooperation.
- **Phorest → Vagaro is concierge-only.** You contact Phorest support, they
  hand you files, Vagaro's team takes 1–3 business days. Nobody in this
  category has actually shipped self-serve import for the harder platforms —
  they have shipped "email us your CSV and we'll deal with it."
- **The standard cutover pattern is a parallel run**, not a cutover event: set
  up the new system, start taking _new_ bookings there, let the old system's
  _existing_ appointments play out, only fully retire it once trusted with a
  live Saturday. The one failure mode every guide calls unacceptable is a
  client tapping a booking link and hitting a dead page.

Both findings shape the design below more than any feature list would.

---

## Part 1 — Data import

### The honest constraint

Client identity and appointment facts map cleanly — a name, a phone number, a
past visit date are the same kind of thing everywhere. **Service names do
not.** Every competitor's service list is free text — "Root Touch Up," "Full
Head Colour + Toner," "Balayage w/ Gloss" — and booking here is gated by phase
chains (active/processing/rinse durations) that determine whether a slot is
even offered. Silently guessing that "Balayage" maps to a 90/40/45 chain
doesn't just mislabel a record — a wrong guess can misprice or double-book a
chair.

So the pipeline has two speeds on purpose:

| Maps automatically                     | Needs one human decision                               |
| -------------------------------------- | ------------------------------------------------------ |
| Client name, phone, email, tags        | Service name → this platform's service + phase chain   |
| Past appointment date, duration, price | Free-text colour notes → structured level/tone/formula |
| Staff names (as placeholders)          | Stylist skill/capability assignment                    |

The right unit for the review step is **distinct service names, not import
rows.** A salon with 4,000 historical appointments typically has 30–50
distinct service names. The owner confirms each one once; every row carrying
that name inherits the decision.

### Pipeline

```
Upload → Parse → Map → Validate & dedupe → Commit → Reconcile
```

**1. Upload.** A wizard at `/s/[salon]/admin/migration`. Accepts CSV/XLSX per
data type, or a platform export .zip. Goes through the existing
`storagePort()` — the same signed-URL infrastructure already handling photo
uploads, just for documents.

**2. Parse.** A new pure domain module, `src/domain/migration/`, parallel to
`src/domain/consultation/` in spirit: no I/O, fully testable, one parser per
source format (`parseVagaroExport`, `parseSquareAppointments`,
`parseGenericCsv`, …) collapsing everything to one intermediate shape,
`RawImportRow[]`. Real-world exports are the actual risk surface here —
inconsistent date formats, merged name fields, currency as text — so this
module deserves the same "provably correct" bar the rules engine gets, not a
best-effort script.

**3. Map.** High-confidence fields apply automatically. Service names surface
a suggested match (fuzzy string match against the salon's real catalog,
already built in W4) for the owner to confirm, create-new, or split. Free-text
formula notes go through the AI port as an _advisory_ parse — "looks like 6N +
20 vol, 45 min" — surfaced to the stylist at the client's first post-cutover
visit rather than blocking import, which keeps intact the existing rule that
nothing the AI layer produces commits without a named person accepting it.

**4. Validate & dedupe.** Fuzzy-match phone/email against clients already in
the system — necessary the moment a salon is running a parallel trial and
some clients have already booked through both. Flag matches for merge rather
than silently creating a duplicate; `ClientProfile.mergedIntoId` already
exists in the schema for exactly this.

**5. Commit.** Runs as a background `Job` (existing queue,
`type: 'migration.commit'`) — a few thousand rows is real write volume and an
owner should not sit on a spinner. Idempotent via the existing `dedupeKey`
field, so a retried or resumed import cannot double-write.

**6. Reconcile.** A new `ImportBatch` row is the parent of everything an
import creates, so **undo is one operation, not a support ticket.** The owner
will get the first CSV wrong; they need to retry without fear.

### Schema additions

```prisma
model ImportBatch {
  id             String    @id @default(cuid())
  salonId        String
  salon          Salon     @relation(fields: [salonId], references: [id], onDelete: Cascade)
  sourcePlatform ImportSourcePlatform
  status         ImportBatchStatus @default(PENDING)
  countsJson     Json?     // { clientsImported, clientsSkipped, appointmentsImported, servicesUnmapped, ... }
  createdByUserId String
  startedAt      DateTime? @db.Timestamptz(3)
  completedAt    DateTime? @db.Timestamptz(3)
  createdAt      DateTime  @default(now()) @db.Timestamptz(3)

  @@index([salonId, status])
}
```

Plus a nullable `importBatchId` on `ClientProfile`, `Appointment`, and
`Formula`, so every imported row traces to its batch — that FK is what makes
undo safe and audit-log entries meaningful.

Not a new **port**. Payments, SMS, storage abstract a live third-party
service this platform calls indefinitely; import is one-time, file-based ETL.
Forcing it into the ports pattern for consistency would be the wrong kind of
tidy — it belongs as a domain module plus a job handler.

### Source priority

1. **Generic CSV/XLSX** — the fallback for everything, and often the only
   thing a locked-down platform will hand over
2. **Vagaro, Square, Fresha, Booksy** — largest installed base; Square has a
   real public API, which is worth a live OAuth pull instead of a file upload
3. **Phorest, Boulevard, Mindbody** — concierge-tier sources. Same pipeline,
   but the "connector" is a request-script the owner sends their old
   platform's support desk, plus a parser tolerant of messier formats

---

## Part 2 — Cutover, not just import

The data problem is necessary but not sufficient. The research is specific
about what makes a switch feel safe versus reckless, and none of it is about
field-mapping accuracy.

**Parallel-run is a first-class mode, not a side effect.** A salon sets a
future go-live date. Between import and go-live, the old system stays the
system of record and staff can poke at the new one risk-free. This has one
concrete design consequence: **past appointments import as plain historical
rows, but _future_ appointments pulled from the old platform must go through
the real booking/hold path**, not a raw insert — otherwise both systems
believe a chair is free at 2pm Tuesday and the parallel run is the thing that
causes the double-booking it was meant to prevent.

**A checklist, not a button.** Owners do not trust a single "Migrate now" — a
black box is a scary thing to press. This platform already has the right
pattern for this in `buildSteps` / `completionRatio` from the consultation
flow; reuse it here: clients imported ✓, appointment history imported ✓,
services mapped (12 of 14) ⚠, upcoming appointments imported, booking link
live, staff invited. Visible progress against a known list is what makes an
owner comfortable enough to flip it.

**The booking link cannot go dark, ever.** This is the one outcome every
source calls unacceptable — a client tapping a link from Instagram, Google
Business Profile, or a Linktree and hitting nothing. Concretely: let the
owner claim `/s/[salon-slug]` and get a redirect snippet for their existing
links **the moment they start the migration**, fully decoupled from how much
data has actually landed. The URL should be live and correct before the first
CSV is even uploaded.

**SMS/marketing consent does not travel automatically.** If a salon used text
reminders on the old platform, that consent list is not silently portable —
opt-in consent is generally tied to the sender and context it was given in,
and importing 2,000 phone numbers as pre-consented is a liability, not a
convenience. Re-confirm on first contact after cutover. The schema already
has `ContactConsent` and `SuppressionEntry` for exactly this distinction; the
import path should feed them deliberately rather than bypass them.

**Staff import stays shallow on purpose.** Bring staff over as `StylistProfile`
shells the owner assigns real logins to via the existing `Invitation` flow.
Do **not** auto-import skill/capability data — no competitor platform models
stylist capability against a phase chain, so there is nothing correct to
import. Five minutes of deliberate setup beats a wrong guess that silently
routes a colour-correction to someone who does not do colour corrections.

---

## Suggested sequencing

| Phase | Scope                                                                               | Why this order                                                                                          |
| ----- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **1** | Generic CSV import — clients, appointment history, service-mapping review screen    | Removes the single biggest reason an owner delays switching, without needing any source-specific parser |
| **2** | Vagaro, Square, Fresha, Booksy parsers                                              | Covers the largest share of the installed base; skips the CSV-cleanup step for most incoming salons     |
| **3** | Go-live checklist, parallel-run-aware future-appointment import, booking-link claim | Makes the _switch itself_ safe, not just the data                                                       |
| **4** | AI-assisted formula/note parsing into structured shade data                         | Highest polish, lowest urgency — nice on day one, not required for day one                              |

Phase 1 alone is the thing worth building first: it is the same "ship what
changes Tuesday before the dazzling thing" logic from the earlier roadmap.
Nobody delays switching because formula notes are not perfectly parsed. They
delay because re-entering four years of clients by hand is unthinkable.

---

## Settled decisions

**Who can trigger an import — owner and manager only.** A new
`migration.import` action in the authorization matrix, gated through the
existing `withAuthz` path like every other mutation. This is the correct
restriction: an import can create thousands of client records, touch consent
state, and write appointment history. It is not a front-desk operation.

**Every upload is assigned to a location.** The wizard asks before parsing,
rather than inferring from the file. Multi-site salons are the ones most
likely to switch platforms — they have the most to gain and the most to lose —
and a silent wrong guess puts a client's history at the wrong branch. One
explicit question at upload time removes the ambiguity entirely, and
single-location salons see it pre-filled.

**Source files get a short, explicit retention window.** A raw export holds
more contact PII in one object than the platform otherwise stores anywhere —
a salon's entire client list, in the clear. Once a batch reaches a terminal
state the source file is deleted on a scheduled job, leaving the parsed rows
and the `ImportBatch` audit record but not the original dump. Retention runs
from batch completion rather than upload, so a stalled import is not deleted
out from under an owner mid-review.
