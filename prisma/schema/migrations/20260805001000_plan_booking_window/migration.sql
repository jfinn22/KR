-- The days and times a stylist narrowed a plan to when they approved it.
--
-- "Approve, but Tuesdays and Thursdays only, and start it in the morning" is a
-- real thing a colourist says about a five-hour correction, and until now there
-- was nowhere to put it — the client got the whole open diary and the stylist
-- found out on the day.
--
-- The five columns are WaitlistEntry's, name for name and meaning for meaning,
-- so `domain/scheduling/window.ts` reads both with one filter. Prefixed on the
-- two dates only because ServicePlan already has a `validUntil` and a bare
-- `earliestDate` next to it would read as the same kind of thing.
--
-- Every default is wide open: an approval that says nothing narrows nothing,
-- and every plan approved before today keeps the availability it already had.
ALTER TABLE "ServicePlan"
  ADD COLUMN IF NOT EXISTS "windowEarliestDate" DATE,
  ADD COLUMN IF NOT EXISTS "windowLatestDate"   DATE,
  ADD COLUMN IF NOT EXISTS "dayOfWeekMask"      INTEGER NOT NULL DEFAULT 127,
  ADD COLUMN IF NOT EXISTS "windowStartMinute"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "windowEndMinute"    INTEGER NOT NULL DEFAULT 1440;

-- A window that cannot contain a start time is not a narrowing, it is an
-- outage: the solver would return nothing and the client would be told the
-- salon is fully booked for the next four months. Refuse it at the door.
ALTER TABLE "ServicePlan"
  DROP CONSTRAINT IF EXISTS "service_plan_window_ordered";
ALTER TABLE "ServicePlan"
  ADD CONSTRAINT "service_plan_window_ordered" CHECK (
    "windowStartMinute" >= 0
    AND "windowEndMinute" <= 1440
    AND "windowStartMinute" < "windowEndMinute"
    AND "dayOfWeekMask" BETWEEN 1 AND 127
    AND (
      "windowEarliestDate" IS NULL
      OR "windowLatestDate" IS NULL
      OR "windowEarliestDate" <= "windowLatestDate"
    )
  );
