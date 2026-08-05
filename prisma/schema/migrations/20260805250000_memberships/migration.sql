-- ---------------------------------------------------------------------------
-- Memberships, as a lifecycle rather than a row
-- ---------------------------------------------------------------------------
--
-- `ClientMembership` had a status, a start and a renewal date. Everything a
-- membership actually has to answer is a fraction of a PERIOD — what a plan
-- change costs, how much of the fee is earned, how many free cuts are left —
-- and a single `renewsAt` cannot say how long the period was.
ALTER TABLE "ClientMembership"
  ADD COLUMN IF NOT EXISTS "currentPeriodStart" TIMESTAMPTZ(3);
-- Asked to stop, but paid up to the end of the period. Distinct from
-- `cancelledAt`: somebody who cancels on the 3rd has bought the rest of the
-- month, and ending it the moment they click is taking money for a service
-- withdrawn.
ALTER TABLE "ClientMembership"
  ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
-- What the dunning clock runs from.
ALTER TABLE "ClientMembership"
  ADD COLUMN IF NOT EXISTS "pastDueSince" TIMESTAMPTZ(3);

CREATE INDEX IF NOT EXISTS "ClientMembership_salonId_stripeSubscriptionId_idx"
  ON "ClientMembership"("salonId", "stripeSubscriptionId");

-- ---------------------------------------------------------------------------
-- A ledger, not a counter
-- ---------------------------------------------------------------------------
--
-- Every running total in this platform has eventually been found wrong with
-- nothing to check it against — the visit counter that double-counted for
-- months is the most recent. Benefit uses are rows: they can be counted per
-- period, an allowance resets without anybody sweeping, and a refunded invoice
-- can take its own use back out.
CREATE TABLE IF NOT EXISTS "MembershipBenefitUse" (
  "id"             TEXT NOT NULL,
  "salonId"        TEXT NOT NULL,
  "membershipId"   TEXT NOT NULL,
  "invoiceId"      TEXT,
  -- Which entitlement, so an allowance is per benefit rather than per
  -- membership: a plan with a free cut and a discounted colour has two.
  "entitlementKey" TEXT NOT NULL,
  "label"          TEXT NOT NULL,
  "discountCents"  INTEGER NOT NULL,
  "periodStart"    TIMESTAMPTZ(3) NOT NULL,
  "usedAt"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MembershipBenefitUse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MembershipBenefitUse_salonId_membershipId_periodStart_idx"
  ON "MembershipBenefitUse"("salonId", "membershipId", "periodStart");
CREATE INDEX IF NOT EXISTS "MembershipBenefitUse_salonId_invoiceId_idx"
  ON "MembershipBenefitUse"("salonId", "invoiceId");

ALTER TABLE "MembershipBenefitUse" DROP CONSTRAINT IF EXISTS "MembershipBenefitUse_membershipId_fkey";
ALTER TABLE "MembershipBenefitUse"
  ADD CONSTRAINT "MembershipBenefitUse_membershipId_fkey" FOREIGN KEY ("membershipId")
  REFERENCES "ClientMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  EXECUTE 'ALTER TABLE "MembershipBenefitUse" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "MembershipBenefitUse" FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "MembershipBenefitUse"';
  EXECUTE
    'CREATE POLICY tenant_isolation ON "MembershipBenefitUse" '
    'USING ("salonId" IS NULL OR "salonId" = current_setting(''app.salon_id'', true)) '
    'WITH CHECK ("salonId" IS NULL OR "salonId" = current_setting(''app.salon_id'', true))';
END $$;
