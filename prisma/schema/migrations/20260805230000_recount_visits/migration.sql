-- ---------------------------------------------------------------------------
-- One visit, however many taps it took
-- ---------------------------------------------------------------------------
--
-- `completedVisits` was incremented on both END_CHAIR and CHECK_OUT, which is
-- exactly the sequence the desk's two buttons produce. The counter therefore
-- ran at roughly double for salons that used both and correct for salons that
-- skipped straight to checkout — wrong, and inconsistent between salons.
--
-- The code no longer double-counts. This puts the existing rows right, because
-- a fix with no backfill leaves every historical client carrying the wrong
-- number forever, and the new retention screens read it.
--
-- Recomputed from the appointments rather than halved: halving is wrong for any
-- salon that only ever pressed one button, and there is no column recording
-- which habit a salon had.
UPDATE "ClientProfile" c
SET "completedVisits" = COALESCE(a.count, 0),
    "firstVisitAt"    = a.first,
    "lastVisitAt"     = COALESCE(a.last, c."lastVisitAt")
FROM (
  SELECT "clientProfileId",
         COUNT(*)          AS count,
         MIN("startsAt")   AS first,
         MAX("startsAt")   AS last
  FROM "Appointment"
  WHERE "status" = 'COMPLETED'
  GROUP BY "clientProfileId"
) a
WHERE a."clientProfileId" = c.id;

-- A client with no completed appointment at all has none, whatever the counter
-- said. Left as a separate statement because the join above cannot see them.
UPDATE "ClientProfile" c
SET "completedVisits" = 0
WHERE c."completedVisits" <> 0
  AND NOT EXISTS (
    SELECT 1 FROM "Appointment" a
    WHERE a."clientProfileId" = c.id AND a."status" = 'COMPLETED'
  );
