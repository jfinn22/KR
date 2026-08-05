-- ---------------------------------------------------------------------------
-- What the colour actually cost
-- ---------------------------------------------------------------------------
--
-- A salon knows what it charges for a balayage and almost never knows what one
-- costs to deliver. Backbar cost is per gram; a purchase is per tube; and
-- nothing in the schema bridged the two.
--
-- Nullable rather than defaulted. A guessed tube size produces a made-up
-- margin, and an owner acts on a margin they believe — no answer is better than
-- a confident wrong one.
ALTER TABLE "RetailProduct" ADD COLUMN IF NOT EXISTS "backbarGramsPerUnit" INTEGER;
ALTER TABLE "RetailProduct" ADD COLUMN IF NOT EXISTS "isBackbar" BOOLEAN NOT NULL DEFAULT false;
