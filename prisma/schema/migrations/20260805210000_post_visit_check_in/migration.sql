-- ---------------------------------------------------------------------------
-- The 72-hour check-in
-- ---------------------------------------------------------------------------
--
-- A one-tap link, sent a few days after an appointment. A link rather than a
-- reply, deliberately: `MessageDirection.INBOUND` exists and nothing writes it,
-- a real reply channel needs another provider webhook and somebody to read the
-- replies, and a salon that asks a question it does not read has done worse
-- than not asking.
--
-- The window is the whole point. A client who says on Thursday that the tone
-- went brassy can be put right on Saturday; one who says it in six weeks has
-- already told three friends.

DO $$ BEGIN
  CREATE TYPE "CheckInSentiment" AS ENUM ('DELIGHTED', 'FINE', 'NOT_RIGHT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PostVisitCheckIn" (
  "id"               TEXT NOT NULL,
  "salonId"          TEXT NOT NULL,
  "appointmentId"    TEXT NOT NULL,
  "clientProfileId"  TEXT NOT NULL,
  -- SHA-256 of the token; the token itself exists only inside the link.
  --
  -- Never `Appointment.checkInToken`, which is `chk_${holdId}` — a value the
  -- browser was already handed at booking time, stored in the clear, with no
  -- expiry and no consumed marker. Reusing it would give every client a working
  -- link to their own feedback the moment they booked.
  "tokenHash"        TEXT NOT NULL,
  "expiresAt"        TIMESTAMPTZ(3) NOT NULL,
  "respondedAt"      TIMESTAMPTZ(3),
  "sentiment"        "CheckInSentiment",
  "note"             TEXT,
  "resolvedAt"       TIMESTAMPTZ(3),
  "resolvedByUserId" TEXT,
  "createdAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostVisitCheckIn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PostVisitCheckIn_appointmentId_key"
  ON "PostVisitCheckIn"("appointmentId");
CREATE UNIQUE INDEX IF NOT EXISTS "PostVisitCheckIn_tokenHash_key"
  ON "PostVisitCheckIn"("tokenHash");
CREATE INDEX IF NOT EXISTS "PostVisitCheckIn_salonId_respondedAt_idx"
  ON "PostVisitCheckIn"("salonId", "respondedAt");
CREATE INDEX IF NOT EXISTS "PostVisitCheckIn_salonId_sentiment_resolvedAt_idx"
  ON "PostVisitCheckIn"("salonId", "sentiment", "resolvedAt");

ALTER TABLE "PostVisitCheckIn" DROP CONSTRAINT IF EXISTS "PostVisitCheckIn_salonId_fkey";
ALTER TABLE "PostVisitCheckIn"
  ADD CONSTRAINT "PostVisitCheckIn_salonId_fkey" FOREIGN KEY ("salonId")
  REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PostVisitCheckIn" DROP CONSTRAINT IF EXISTS "PostVisitCheckIn_appointmentId_fkey";
ALTER TABLE "PostVisitCheckIn"
  ADD CONSTRAINT "PostVisitCheckIn_appointmentId_fkey" FOREIGN KEY ("appointmentId")
  REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PostVisitCheckIn" DROP CONSTRAINT IF EXISTS "PostVisitCheckIn_clientProfileId_fkey";
ALTER TABLE "PostVisitCheckIn"
  ADD CONSTRAINT "PostVisitCheckIn_clientProfileId_fkey" FOREIGN KEY ("clientProfileId")
  REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, same as every other tenant table.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "PostVisitCheckIn" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "PostVisitCheckIn" FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "PostVisitCheckIn"';
  EXECUTE
    'CREATE POLICY tenant_isolation ON "PostVisitCheckIn" '
    'USING ("salonId" IS NULL OR "salonId" = current_setting(''app.salon_id'', true)) '
    'WITH CHECK ("salonId" IS NULL OR "salonId" = current_setting(''app.salon_id'', true))';
END $$;

-- ---------------------------------------------------------------------------
-- Somewhere to sweep the attempt log from
-- ---------------------------------------------------------------------------
--
-- `PublicActionAttempt` gets a row on every unauthenticated call — successes,
-- double-taps and link prefetchers alike — and nothing has ever deleted one. A
-- retention feature that fires at every completed appointment would make it the
-- fastest-growing table in the database. The reaper needs this index to find
-- the old rows without walking the whole table.
CREATE INDEX IF NOT EXISTS "PublicActionAttempt_createdAt_idx"
  ON "PublicActionAttempt"("createdAt");
