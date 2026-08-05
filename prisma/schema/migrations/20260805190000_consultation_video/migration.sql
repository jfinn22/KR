-- A short clip of the hair moving.
--
-- `ConsultationMode.VIDEO` has been one of four modes since the schema was
-- written, and `pickMode` has had a branch returning it — with nowhere for the
-- client to go once it did. This table is where it goes.
--
-- ASYNC, deliberately. A live call needs scheduling, a provider, a waiting room
-- and two people free at the same moment, and it is worse at the actual job: a
-- stylist watching a recording at eight in the evening can scrub back to the
-- bit where the light catches the banding, and on a call they cannot.
--
-- A separate table rather than a ConsultationPhoto with a video mime type, so
-- every existing query for photos keeps returning photos.
CREATE TABLE IF NOT EXISTS "ConsultationVideo" (
  "id"             TEXT NOT NULL,
  "salonId"        TEXT NOT NULL,
  "consultationId" TEXT NOT NULL,
  "photoAssetId"   TEXT NOT NULL,
  -- What the client was asked to show, so the stylist knows what they are
  -- looking at before they press play.
  "prompt"         TEXT,
  "clientNote"     TEXT,
  "durationSec"    INTEGER,
  "sequence"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsultationVideo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ConsultationVideo_salonId_consultationId_idx"
  ON "ConsultationVideo"("salonId", "consultationId");

ALTER TABLE "ConsultationVideo" DROP CONSTRAINT IF EXISTS "ConsultationVideo_salonId_fkey";
ALTER TABLE "ConsultationVideo"
  ADD CONSTRAINT "ConsultationVideo_salonId_fkey" FOREIGN KEY ("salonId")
  REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsultationVideo" DROP CONSTRAINT IF EXISTS "ConsultationVideo_consultationId_fkey";
ALTER TABLE "ConsultationVideo"
  ADD CONSTRAINT "ConsultationVideo_consultationId_fkey" FOREIGN KEY ("consultationId")
  REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cascade from the asset too: a video row whose file has been deleted is a
-- broken play button, and a broken play button on a consultation screen reads
-- as the platform having lost something.
ALTER TABLE "ConsultationVideo" DROP CONSTRAINT IF EXISTS "ConsultationVideo_photoAssetId_fkey";
ALTER TABLE "ConsultationVideo"
  ADD CONSTRAINT "ConsultationVideo_photoAssetId_fkey" FOREIGN KEY ("photoAssetId")
  REFERENCES "PhotoAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, same as every other tenant table.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "ConsultationVideo" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "ConsultationVideo" FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "ConsultationVideo"';
  EXECUTE
    'CREATE POLICY tenant_isolation ON "ConsultationVideo" '
    'USING ("salonId" IS NULL OR "salonId" = current_setting(''app.salon_id'', true)) '
    'WITH CHECK ("salonId" IS NULL OR "salonId" = current_setting(''app.salon_id'', true))';
END $$;

-- --------------------------------------------------------------------------
-- In-chair consultations
-- --------------------------------------------------------------------------
-- Filled in with the client in the chair, by a stylist, on their own device.
--
-- Distinct from `mode`, and the distinction matters: `mode` is the engine's
-- answer to "how does this NEED to be assessed" and is overwritten on every
-- evaluation. This is a fact about how it actually happened, and nothing
-- recomputes it.
--
-- Worth recording because the answers are different in kind. A stylist looking
-- at the hair while they answer gives better data than a client guessing at
-- their own porosity — and a reviewer is entitled to know which they are
-- reading before they trust it.
ALTER TABLE "Consultation"
  ADD COLUMN IF NOT EXISTS "startedInChair" BOOLEAN NOT NULL DEFAULT false;
