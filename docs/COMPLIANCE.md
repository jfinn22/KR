# Compliance

## The position, stated plainly

This platform **manages** consent, waivers and policy acknowledgements. It does
not **supply** legal language.

Every form template shipped with the product carries `isLegalPlaceholder = true`
in the database. The template editor surfaces that flag and will not let a salon
hide the notice while it is set. The wording is illustrative scaffolding so the
flows can be built and tested — it is not legal advice and has not been reviewed
by anyone qualified to give it.

**Before any salon uses these forms with a real client, the wording must be
drafted or reviewed by an attorney familiar with salon, consumer, privacy and
liability law in every jurisdiction the salon operates in.** Requirements differ
materially between countries, and between US states.

## What the platform does provide

- **Versioned templates.** A submission records `templateVersion` and a
  `documentHash` of the exact rendered document, so a later edit cannot change
  what a client is shown to have agreed to.
- **Signature capture** with method, signer name, relationship, timestamp, IP
  and user agent.
- **Expiry.** `validForDays` on the template; the rules engine treats an expired
  patch test as absent rather than as present-and-stale.
- **Consent grants** as first-class records with grant and revoke timestamps,
  linked to the submission that evidences them.
- **Contact consent** separated by channel and by purpose (transactional versus
  marketing), checked at send time rather than at schedule time — so a client
  who opts out on Tuesday does not receive Monday's queued reminder.
- **Audit.** Every override, waiver and policy change is written to `AuditLog`
  with the actor, the reason and the before/after state.

## Form inventory

| Key                          | Kind               | Notes                                          |
| ---------------------------- | ------------------ | ---------------------------------------------- |
| `CHEMICAL_SERVICE_CONSENT`   | CHEMICAL_SERVICE   | Gated by the rules engine on chemical services |
| `COLOUR_ALLERGY_WAIVER`      | WAIVER             | Required by `ALLERGY_OXIDATIVE_COLOUR`         |
| `PATCH_TEST_CONSENT`         | PATCH_TEST         | Paired with the `PatchTest` record             |
| `PHOTO_RELEASE`              | PHOTO_RELEASE      | Distinct from marketing use                    |
| `MARKETING_PHOTO_CONSENT`    | PHOTO_RELEASE      | Separate grant; revocable independently        |
| `EXTENSION_CONSENT`          | EXTENSION          | Tension and maintenance acknowledgement        |
| `CORRECTION_SERVICE_CONSENT` | CORRECTION_SERVICE | Multi-session expectations                     |
| `LATE_CANCELLATION_POLICY`   | POLICY             | Acknowledged at booking                        |
| `MINOR_GUARDIAN_CONSENT`     | MINOR_GUARDIAN     | Required by `MINOR_REQUIRES_GUARDIAN`          |
| `LIABILITY_WAIVER`           | WAIVER             | General                                        |

## Photographs

Client photographs are the most sensitive data the platform holds. The schema
supports all of the following; the ones marked _(not yet implemented)_ are
requirements on the photo-processing job and storage adapter, which are part of
workstreams that have not been built yet — see `docs/STATUS.md`.

- **EXIF stripping** before an image is displayed, shared, or sent to any
  adapter. EXIF carries GPS coordinates. `PhotoAsset.exifStripped` records it.
  _(not yet implemented — the flag exists and defaults to false)_
- **Short-lived signed URLs.** No public buckets. _(not yet implemented)_
- **Marketing use requires a separate grant** from the record-keeping release.
  A client consenting to photos on their chart has not consented to Instagram.
  Modelled as distinct `ConsentGrant` kinds with independent revocation.
- **AI photo analysis requires its own `AI_PHOTO_ANALYSIS` grant** _and_ the
  `SalonSettings.aiPhotoAnalysisEnabled` flag, which defaults to off. Both
  exist in the schema; the enforcement lives in the AI service _(not yet
  implemented)_.
- **Client erasure** cascades to photo assets and leaves a tombstone in
  `AuditLog`. _(not yet implemented)_

## Data protection

`client.export` and `client.erase` are owner-only actions. Erasure is deliberately
not available to managers: it is irreversible, and the blast radius of a mistake
is a permanently destroyed clinical record.

Retention, lawful basis, data-processing agreements with the real adapters
(Stripe, Twilio, Resend, S3, Anthropic) and any cross-border transfer analysis
are deployment concerns and are **not** configured by this repository.
