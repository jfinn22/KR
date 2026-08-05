-- ---------------------------------------------------------------------------
-- The dates a fade prediction needs and nothing recorded
-- ---------------------------------------------------------------------------
--
-- Three of these are gaps rather than additions.
--
-- `SALON_COLOR` was in the `ChemicalKind` union from the beginning and was
-- never pushed onto the history array, so the obvious question — when was this
-- client's last professional colour — returned "never" for everybody.
--
-- `BLEACH` was pushed with a hardcoded null date, so lightening recency read as
-- "long ago but present" whether the client was lifted last week or in 2015.
--
-- And growth rate is nullable on purpose: a prediction that quietly assumes the
-- average should be able to say so, and hair varies by about a third either
-- side of it — which over ten weeks is the difference between roots that show
-- and roots that do not.
ALTER TABLE "HairProfile" ADD COLUMN IF NOT EXISTS "bleachLastAt"     DATE;
ALTER TABLE "HairProfile" ADD COLUMN IF NOT EXISTS "hasSalonColor"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HairProfile" ADD COLUMN IF NOT EXISTS "salonColorLastAt" DATE;
ALTER TABLE "HairProfile" ADD COLUMN IF NOT EXISTS "tonerLastAt"      DATE;
ALTER TABLE "HairProfile" ADD COLUMN IF NOT EXISTS "growthCmPerMonth" DECIMAL(3,2);
