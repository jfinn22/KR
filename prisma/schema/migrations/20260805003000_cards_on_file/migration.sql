-- Cards on file, and the deposit lifecycle that needed one.
--
-- Deposits have been authorising against a fresh intent with no card behind it,
-- which is why nothing ever captured: there was nothing to capture against. A
-- deposit taken six weeks before an appointment is a promise, and keeping a
-- promise needs a card the client agreed we could keep.

-- --------------------------------------------------------------------------
-- 1. A card the client agreed we could keep
-- --------------------------------------------------------------------------
-- Never a card number. Only the provider's reference to one, plus the four
-- digits and the brand a person needs to recognise which card they are looking
-- at. Every row of this table is worthless to whoever steals it.
CREATE TABLE IF NOT EXISTS "SavedCard" (
  "id"              TEXT NOT NULL,
  "salonId"         TEXT NOT NULL,
  "clientProfileId" TEXT NOT NULL,
  "providerRef"     TEXT NOT NULL,
  "brand"           TEXT NOT NULL,
  "last4"           TEXT NOT NULL,
  "expMonth"        INTEGER NOT NULL,
  "expYear"         INTEGER NOT NULL,
  "isDefault"       BOOLEAN NOT NULL DEFAULT false,
  -- Removed by the client rather than deleted: a deposit already charged
  -- against it still has to be explainable a year later.
  "detachedAt"      TIMESTAMPTZ(3),
  "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedCard_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SavedCard" DROP CONSTRAINT IF EXISTS "saved_card_sane";
ALTER TABLE "SavedCard"
  ADD CONSTRAINT "saved_card_sane" CHECK (
    length("last4") = 4
    AND "expMonth" BETWEEN 1 AND 12
    AND "expYear" BETWEEN 2000 AND 2100
  );

CREATE UNIQUE INDEX IF NOT EXISTS "SavedCard_salonId_providerRef_key"
  ON "SavedCard"("salonId", "providerRef");
CREATE INDEX IF NOT EXISTS "SavedCard_salonId_clientProfileId_detachedAt_idx"
  ON "SavedCard"("salonId", "clientProfileId", "detachedAt");

ALTER TABLE "SavedCard" DROP CONSTRAINT IF EXISTS "SavedCard_salonId_fkey";
ALTER TABLE "SavedCard"
  ADD CONSTRAINT "SavedCard_salonId_fkey" FOREIGN KEY ("salonId")
  REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SavedCard" DROP CONSTRAINT IF EXISTS "SavedCard_clientProfileId_fkey";
ALTER TABLE "SavedCard"
  ADD CONSTRAINT "SavedCard_clientProfileId_fkey" FOREIGN KEY ("clientProfileId")
  REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The provider's customer for this person AT THIS SALON. A client of two
-- salons has two, because each salon's provider account is its own — and a
-- single global customer would let one salon charge a card another salon
-- collected.
ALTER TABLE "ClientProfile"
  ADD COLUMN IF NOT EXISTS "paymentsCustomerRef" TEXT;

-- --------------------------------------------------------------------------
-- 2. What a deposit was missing
-- --------------------------------------------------------------------------
-- `authorizationExpiresAt` and `appliedToPaymentId` have been on this table
-- since it was written and were never read or written by anything, because
-- there was no state machine to write them. There is now.
ALTER TABLE "Deposit"
  ADD COLUMN IF NOT EXISTS "consultationId"  TEXT,
  ADD COLUMN IF NOT EXISTS "savedCardId"     TEXT,
  -- The bill this deposit was spent on. Not derivable from `appointmentId`:
  -- a paid consultation is credited against the corrective work booked
  -- afterwards, which is a different appointment entirely.
  ADD COLUMN IF NOT EXISTS "appliedToInvoiceId" TEXT,
  -- Why a charge failed, in the provider's words. "Your card was declined" and
  -- "your bank wants you to confirm this" need different things from a client,
  -- and "payment failed" tells them neither.
  ADD COLUMN IF NOT EXISTS "failureCode"     TEXT,
  ADD COLUMN IF NOT EXISTS "failureMessage"  TEXT;

ALTER TABLE "Deposit" DROP CONSTRAINT IF EXISTS "Deposit_consultationId_fkey";
ALTER TABLE "Deposit"
  ADD CONSTRAINT "Deposit_consultationId_fkey" FOREIGN KEY ("consultationId")
  REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Deposit" DROP CONSTRAINT IF EXISTS "Deposit_savedCardId_fkey";
ALTER TABLE "Deposit"
  ADD CONSTRAINT "Deposit_savedCardId_fkey" FOREIGN KEY ("savedCardId")
  REFERENCES "SavedCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Deposit" DROP CONSTRAINT IF EXISTS "Deposit_appliedToInvoiceId_fkey";
ALTER TABLE "Deposit"
  ADD CONSTRAINT "Deposit_appliedToInvoiceId_fkey" FOREIGN KEY ("appliedToInvoiceId")
  REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The provider is the source of truth for payment state, and a webhook is how
-- it says so. One live deposit per intent means a redelivered event reconciles
-- the row it already wrote instead of finding two and picking wrong.
--
-- The column is nullable and that is fine: Postgres treats every NULL as
-- distinct in a unique index, so any number of deposits can sit at PENDING
-- with no intent yet while every deposit that HAS reached the provider is
-- unique on it.
DROP INDEX IF EXISTS "Deposit_providerIntentId_key";
CREATE UNIQUE INDEX "Deposit_providerIntentId_key" ON "Deposit"("providerIntentId");

-- --------------------------------------------------------------------------
-- 3. What a corrective consultation costs
-- --------------------------------------------------------------------------
-- Zero by default, which means free — what most salons want and all of them
-- start with. It exists because a corrective assessment is an hour of a senior
-- stylist's time, often for somebody another salon damaged, and a salon that
-- cannot charge for it either stops offering it or does it at a loss.
--
-- Credited against the work booked from it, which is what keeps it from being
-- a fee: the client pays for the assessment only if they walk away.
ALTER TABLE "SalonSettings"
  ADD COLUMN IF NOT EXISTS "correctiveConsultFeeCents" INTEGER NOT NULL DEFAULT 0;

-- --------------------------------------------------------------------------
-- 4. Row-level security on the new tenant table
-- --------------------------------------------------------------------------
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "SavedCard" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "SavedCard" FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "SavedCard"';
  EXECUTE
    'CREATE POLICY tenant_isolation ON "SavedCard" '
    'USING ("salonId" IS NULL OR "salonId" = current_setting(''app.salon_id'', true)) '
    'WITH CHECK ("salonId" IS NULL OR "salonId" = current_setting(''app.salon_id'', true))';
END $$;
