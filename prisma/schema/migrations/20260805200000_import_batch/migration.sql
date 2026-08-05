-- ---------------------------------------------------------------------------
-- Coming from another platform
-- ---------------------------------------------------------------------------
--
-- A salon's whole history arrives once, in a file somebody else's software
-- wrote, and the owner will get the first attempt wrong. Everything below
-- exists so that getting it wrong costs one click: every row an import creates
-- points back at the batch that created it.

DO $$ BEGIN
  CREATE TYPE "ImportSourcePlatform" AS ENUM ('GENERIC', 'VAGARO', 'SQUARE', 'FRESHA', 'BOOKSY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ImportBatchStatus" AS ENUM
    ('PENDING', 'REVIEWING', 'COMMITTING', 'COMPLETED', 'FAILED', 'UNDONE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ImportBatch" (
  "id"              TEXT NOT NULL,
  "salonId"         TEXT NOT NULL,
  -- Asked at upload, never inferred from the file. Multi-site salons are the
  -- ones most likely to be switching platforms, and a silent wrong guess puts a
  -- client's history at the wrong branch.
  "locationId"      TEXT NOT NULL,
  "sourcePlatform"  "ImportSourcePlatform" NOT NULL DEFAULT 'GENERIC',
  "status"          "ImportBatchStatus" NOT NULL DEFAULT 'PENDING',
  "filename"        TEXT NOT NULL,
  -- Storage key of the raw upload, nulled when the file is deleted. A raw
  -- export holds more contact PII in one object than the platform stores
  -- anywhere else, so it does not live here indefinitely.
  "sourceAssetKey"  TEXT,
  "sourceDeletedAt" TIMESTAMPTZ(3),
  -- The answers only a person can give: date order, calling code, service map.
  "optionsJson"     JSONB,
  -- What it did. Written on completion and never recomputed.
  "countsJson"      JSONB,
  "problem"         TEXT,
  "createdByUserId" TEXT NOT NULL,
  "startedAt"       TIMESTAMPTZ(3),
  "completedAt"     TIMESTAMPTZ(3),
  "undoneAt"        TIMESTAMPTZ(3),
  "undoneByUserId"  TEXT,
  "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ImportBatch_salonId_status_idx" ON "ImportBatch"("salonId", "status");
CREATE INDEX IF NOT EXISTS "ImportBatch_salonId_createdAt_idx" ON "ImportBatch"("salonId", "createdAt");

ALTER TABLE "ImportBatch" DROP CONSTRAINT IF EXISTS "ImportBatch_salonId_fkey";
ALTER TABLE "ImportBatch"
  ADD CONSTRAINT "ImportBatch_salonId_fkey" FOREIGN KEY ("salonId")
  REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ImportBatch" DROP CONSTRAINT IF EXISTS "ImportBatch_locationId_fkey";
ALTER TABLE "ImportBatch"
  ADD CONSTRAINT "ImportBatch_locationId_fkey" FOREIGN KEY ("locationId")
  REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, same as every other tenant table.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "ImportBatch" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "ImportBatch" FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "ImportBatch"';
  EXECUTE
    'CREATE POLICY tenant_isolation ON "ImportBatch" '
    'USING ("salonId" IS NULL OR "salonId" = current_setting(''app.salon_id'', true)) '
    'WITH CHECK ("salonId" IS NULL OR "salonId" = current_setting(''app.salon_id'', true))';
END $$;

-- ---------------------------------------------------------------------------
-- Provenance on everything an import can create
-- ---------------------------------------------------------------------------
--
-- ON DELETE SET NULL, deliberately. Deleting a batch must never take a salon's
-- clients with it — the batch is the audit record of an event, not the owner of
-- the people. Undo walks these columns explicitly and decides row by row.

ALTER TABLE "ClientProfile" ADD COLUMN IF NOT EXISTS "importBatchId" TEXT;
ALTER TABLE "ClientProfile" DROP CONSTRAINT IF EXISTS "ClientProfile_importBatchId_fkey";
ALTER TABLE "ClientProfile"
  ADD CONSTRAINT "ClientProfile_importBatchId_fkey" FOREIGN KEY ("importBatchId")
  REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ClientProfile_importBatchId_idx" ON "ClientProfile"("importBatchId");

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "importBatchId" TEXT;
ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS "Appointment_importBatchId_fkey";
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_importBatchId_fkey" FOREIGN KEY ("importBatchId")
  REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Appointment_importBatchId_idx" ON "Appointment"("importBatchId");

ALTER TABLE "Formula" ADD COLUMN IF NOT EXISTS "importBatchId" TEXT;
ALTER TABLE "Formula" DROP CONSTRAINT IF EXISTS "Formula_importBatchId_fkey";
ALTER TABLE "Formula"
  ADD CONSTRAINT "Formula_importBatchId_fkey" FOREIGN KEY ("importBatchId")
  REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Formula_importBatchId_idx" ON "Formula"("importBatchId");
