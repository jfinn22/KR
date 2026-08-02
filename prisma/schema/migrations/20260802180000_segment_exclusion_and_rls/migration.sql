-- ---------------------------------------------------------------------------
-- Hand-written migration. Prisma cannot express any of this.
--
--   1. A generated tstzrange column on AppointmentSegment
--   2. Exclusion constraints that make an overlapping booking physically
--      impossible, rather than merely unlikely
--   3. A GiST index for the availability range scan
--   4. LISTEN/NOTIFY so the job worker wakes immediately on enqueue
--   5. Row-level security on every salon-owned table
--
-- ---------------------------------------------------------------------------

-- 1 -------------------------------------------------------------------------
-- Half-open '[)' so an appointment ending at 10:00 and one starting at 10:00
-- do NOT overlap. Closed ranges would reject every back-to-back booking.
ALTER TABLE "AppointmentSegment"
  ADD COLUMN "period" tstzrange
  GENERATED ALWAYS AS (tstzrange("startsAt", "endsAt", '[)')) STORED;

-- 2 -------------------------------------------------------------------------
-- The application proposes; the database disposes. Holds (state='HOLD') and
-- confirmed bookings (state='ACTIVE') share this constraint, so a hold really
-- does reserve the slot instead of merely intending to.
--
-- PROCESSING segments carry blocksStylist = false and are therefore excluded
-- from the stylist predicate. That single fact is what allows a colourist to
-- take another client while someone processes -- interleaving falls out of the
-- data model rather than being special-cased in the solver.
ALTER TABLE "AppointmentSegment"
  ADD CONSTRAINT "segment_stylist_no_overlap"
  EXCLUDE USING gist ("stylistProfileId" WITH =, "period" WITH &&)
  WHERE ("blocksStylist" AND "state" IN ('ACTIVE', 'HOLD') AND "stylistProfileId" IS NOT NULL);

-- A concrete resource is assigned at hold time, which turns "capacity >= 1"
-- into a per-row exclusion the database can enforce directly.
ALTER TABLE "AppointmentSegment"
  ADD CONSTRAINT "segment_resource_no_overlap"
  EXCLUDE USING gist ("resourceId" WITH =, "period" WITH &&)
  WHERE ("blocksResource" AND "state" IN ('ACTIVE', 'HOLD') AND "resourceId" IS NOT NULL);

-- 3 -------------------------------------------------------------------------
CREATE INDEX "segment_salon_period_gist"
  ON "AppointmentSegment" USING gist ("salonId", "period")
  WHERE "state" IN ('ACTIVE', 'HOLD');

-- 4 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION job_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('job_enqueued', NEW.queue);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER job_notify_trg
  AFTER INSERT ON "Job"
  FOR EACH ROW WHEN (NEW.status = 'PENDING')
  EXECUTE FUNCTION job_notify();

-- 5 -------------------------------------------------------------------------
-- Row-level security on every table carrying a salonId.
--
-- Driven off the catalog rather than a hand-maintained list, so a table added
-- in a later migration is covered the moment this block is re-run, and
-- tests/integration/tenant-isolation asserts coverage independently.
--
-- Fail-closed by construction: with app.salon_id unset, current_setting(...)
-- returns NULL, `"salonId" = NULL` is NULL, and no tenant row is visible.
-- Rows with a NULL salonId are the shared platform library (starter
-- consultation templates, system form templates) and stay readable.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'salonId' AND NOT a.attisdropped
      )
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING ("salonId" IS NULL OR "salonId" = current_setting(''app.salon_id'', true)) '
      'WITH CHECK ("salonId" IS NULL OR "salonId" = current_setting(''app.salon_id'', true))',
      t.table_name
    );
  END LOOP;
END $$;

-- The Salon row itself is readable by slug before a tenant context exists
-- (login, branded booking page), so it is scoped in the application layer
-- rather than here. Its sensitive configuration lives in SalonSettings, which
-- carries a salonId and is covered by the loop above.
