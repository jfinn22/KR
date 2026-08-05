-- Rate limiting for actions taken before a principal exists.
--
-- Signup, joining by code and claiming a booking link all happen with no
-- account, so none of them can be limited per user. They are limited by
-- (salon, action, fingerprint) over a window instead.
--
-- Written by hand rather than generated: `prisma migrate dev` cannot see the
-- generated `period` column on AppointmentSegment — it is created in raw SQL
-- for the exclusion constraint — and offers to drop it, which would quietly
-- remove the guarantee that double-booking is impossible.

CREATE TABLE "PublicActionAttempt" (
    "id"          TEXT NOT NULL,
    "salonId"     TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicActionAttempt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PublicActionAttempt"
    ADD CONSTRAINT "PublicActionAttempt_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The counting query: attempts for one salon + action + caller inside a window.
CREATE INDEX "PublicActionAttempt_salonId_name_fingerprint_createdAt_idx"
    ON "PublicActionAttempt" ("salonId", "name", "fingerprint", "createdAt");

-- The sweep.
CREATE INDEX "PublicActionAttempt_createdAt_idx"
    ON "PublicActionAttempt" ("createdAt");

-- Row-level security, like every other tenant table.
ALTER TABLE "PublicActionAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PublicActionAttempt" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "PublicActionAttempt"
    USING ("salonId" IS NULL OR "salonId" = current_setting('app.salon_id', true))
    WITH CHECK ("salonId" IS NULL OR "salonId" = current_setting('app.salon_id', true));
