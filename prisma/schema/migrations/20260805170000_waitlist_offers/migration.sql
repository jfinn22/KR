-- The hold standing behind a waitlist offer.
--
-- `WaitlistEntry` has been in the schema since it was written with five fields
-- nothing read, and no way to get onto the list from either side. The matcher
-- that did exist compared the cancelled appointment's raw duration against
-- `requiredDurationMin` and offered its exact start time, which is a different
-- question from "does this client's chain fit here" — a two-hour cancellation
-- does not mean a two-hour service fits in it.
--
-- This column is the one piece of state the rebuild needs. An offer with no
-- hold behind it is a promise the salon cannot keep: the client drops what
-- they are doing, taps accept, and finds the slot gone, which is worse than
-- never having been offered it. The hold blocks the slot for everybody else,
-- and that is the accepted cost — bounded by keeping the hold short and by
-- offering to one person at a time.
ALTER TABLE "WaitlistEntry"
  ADD COLUMN IF NOT EXISTS "offeredHoldId" TEXT;

-- Deliberately not a foreign key. A hold is short-lived and gets deleted;
-- an entry whose hold has gone is a normal state that the sweep reopens,
-- not a dangling reference worth failing a write over.
CREATE INDEX IF NOT EXISTS "WaitlistEntry_salonId_status_offerExpiresAt_idx"
  ON "WaitlistEntry"("salonId", "status", "offerExpiresAt");
