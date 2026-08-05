-- A short code the front desk can read out, so somebody standing at the till
-- joins the right salon without needing the link.
--
-- Optional: a salon that only ever shares its own link never sets one. The
-- signup path treats an unset code as "no code required" rather than as a
-- locked door, because the common case is arriving from the salon's own
-- Instagram bio and there is nothing to check.
ALTER TABLE "SalonSettings" ADD COLUMN IF NOT EXISTS "joinCode" TEXT;
