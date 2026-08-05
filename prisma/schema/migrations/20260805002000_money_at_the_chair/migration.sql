-- Money at the chair: discounts with a reason, gift cards, and the two things
-- an invoice line was throwing away.
--
-- One migration rather than three. Discounts, gift cards and the line-level
-- columns all land on the same table, the same action schemas and the same
-- integration tests; splitting them would mean writing the same backfill
-- reasoning three times and running the suite against three intermediate
-- shapes nobody will ever deploy.

-- --------------------------------------------------------------------------
-- 1. What an invoice line was forgetting
-- --------------------------------------------------------------------------
-- `computeInvoice` has always worked out a per-line discount and then thrown it
-- away — only the net survived, so a receipt could not say "was 95, now 80" and
-- a month-end could not tell a discounted line from a cheap one.
--
-- `agreedUnitPriceCents` is what the client agreed to before anyone touched it
-- at the till. Nullable, because a line nobody edited has nothing to say; a
-- default equal to the charged price would make every line look edited.
ALTER TABLE "InvoiceLine"
  ADD COLUMN IF NOT EXISTS "discountCents"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "agreedUnitPriceCents" INTEGER;

ALTER TABLE "InvoiceLine" DROP CONSTRAINT IF EXISTS "invoice_line_discount_sane";
ALTER TABLE "InvoiceLine"
  ADD CONSTRAINT "invoice_line_discount_sane" CHECK ("discountCents" >= 0);

-- --------------------------------------------------------------------------
-- 2. Why a bill is less than the price list says
-- --------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "DiscountKind" AS ENUM ('PERCENT', 'FIXED', 'OPEN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "DiscountReason" (
  "id"        TEXT NOT NULL,
  "salonId"   TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "kind"      "DiscountKind" NOT NULL DEFAULT 'PERCENT',
  "value"     INTEGER NOT NULL DEFAULT 0,
  "maxCents"  INTEGER,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscountReason_pkey" PRIMARY KEY ("id")
);

-- A percentage over 100 or a negative amount is not a discount, it is a bug
-- that pays the client. The application refuses both; so does the table.
ALTER TABLE "DiscountReason" DROP CONSTRAINT IF EXISTS "discount_reason_value_sane";
ALTER TABLE "DiscountReason"
  ADD CONSTRAINT "discount_reason_value_sane" CHECK (
    "value" >= 0
    AND ("kind" <> 'PERCENT' OR "value" <= 10000)
    AND ("maxCents" IS NULL OR "maxCents" >= 0)
  );

CREATE UNIQUE INDEX IF NOT EXISTS "DiscountReason_salonId_label_key"
  ON "DiscountReason"("salonId", "label");
CREATE INDEX IF NOT EXISTS "DiscountReason_salonId_isActive_sortOrder_idx"
  ON "DiscountReason"("salonId", "isActive", "sortOrder");

ALTER TABLE "DiscountReason" DROP CONSTRAINT IF EXISTS "DiscountReason_salonId_fkey";
ALTER TABLE "DiscountReason"
  ADD CONSTRAINT "DiscountReason_salonId_fkey" FOREIGN KEY ("salonId")
  REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The reason travels with the bill. `discountNote` is the written explanation
-- the policy layer demands when a discount exceeds the giver's cap — a field
-- the action schema already accepted and nothing has ever read.
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "discountReasonId"         TEXT,
  ADD COLUMN IF NOT EXISTS "discountNote"             TEXT,
  ADD COLUMN IF NOT EXISTS "discountApprovedByUserId" TEXT;

ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_discountReasonId_fkey";
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_discountReasonId_fkey" FOREIGN KEY ("discountReasonId")
  REFERENCES "DiscountReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- 3. Gift cards
-- --------------------------------------------------------------------------
-- The balance is deliberately NOT a column. A stored balance and a ledger that
-- disagree is an argument with a customer holding a piece of card, and the
-- ledger is the side that can be audited. `GiftCardEntry` is append-only and
-- the balance is its sum.
DO $$ BEGIN
  CREATE TYPE "GiftCardStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "GiftCardEntryKind" AS ENUM ('ISSUE', 'TOP_UP', 'REDEEM', 'REFUND', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "GiftCard" (
  "id"                  TEXT NOT NULL,
  "salonId"             TEXT NOT NULL,
  "code"                TEXT NOT NULL,
  "initialCents"        INTEGER NOT NULL,
  "status"              "GiftCardStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt"           TIMESTAMPTZ(3),
  "purchasedByClientId" TEXT,
  "issuedOnInvoiceId"   TEXT,
  "note"                TEXT,
  "createdAt"           TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GiftCard" DROP CONSTRAINT IF EXISTS "gift_card_initial_positive";
ALTER TABLE "GiftCard"
  ADD CONSTRAINT "gift_card_initial_positive" CHECK ("initialCents" > 0);

-- Unique per salon, not globally: a gift card is a promise by one salon and
-- means nothing at another, and a global namespace would leak how many cards
-- every other salon on the platform has sold.
CREATE UNIQUE INDEX IF NOT EXISTS "GiftCard_salonId_code_key" ON "GiftCard"("salonId", "code");
CREATE INDEX IF NOT EXISTS "GiftCard_salonId_status_idx" ON "GiftCard"("salonId", "status");

ALTER TABLE "GiftCard" DROP CONSTRAINT IF EXISTS "GiftCard_salonId_fkey";
ALTER TABLE "GiftCard"
  ADD CONSTRAINT "GiftCard_salonId_fkey" FOREIGN KEY ("salonId")
  REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GiftCard" DROP CONSTRAINT IF EXISTS "GiftCard_purchasedByClientId_fkey";
ALTER TABLE "GiftCard"
  ADD CONSTRAINT "GiftCard_purchasedByClientId_fkey" FOREIGN KEY ("purchasedByClientId")
  REFERENCES "ClientProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "GiftCardEntry" (
  "id"              TEXT NOT NULL,
  "salonId"         TEXT NOT NULL,
  "giftCardId"      TEXT NOT NULL,
  "amountCents"     INTEGER NOT NULL,
  "kind"            "GiftCardEntryKind" NOT NULL,
  "invoiceId"       TEXT,
  "paymentId"       TEXT,
  "idempotencyKey"  TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GiftCardEntry_pkey" PRIMARY KEY ("id")
);

-- One entry per (card, key). A double-tapped redemption at the till writes one
-- row, not two — enforced by the index rather than by a check-then-write that
-- two tills can interleave.
CREATE UNIQUE INDEX IF NOT EXISTS "GiftCardEntry_giftCardId_idempotencyKey_key"
  ON "GiftCardEntry"("giftCardId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "GiftCardEntry_salonId_giftCardId_idx"
  ON "GiftCardEntry"("salonId", "giftCardId");

ALTER TABLE "GiftCardEntry" DROP CONSTRAINT IF EXISTS "GiftCardEntry_giftCardId_fkey";
ALTER TABLE "GiftCardEntry"
  ADD CONSTRAINT "GiftCardEntry_giftCardId_fkey" FOREIGN KEY ("giftCardId")
  REFERENCES "GiftCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The sign carries the meaning, so it has to match the kind. A REDEEM that
-- credits the card is how a balance grows every time somebody spends it.
ALTER TABLE "GiftCardEntry" DROP CONSTRAINT IF EXISTS "gift_card_entry_sign";
ALTER TABLE "GiftCardEntry"
  ADD CONSTRAINT "gift_card_entry_sign" CHECK (
    ("kind" IN ('ISSUE', 'TOP_UP') AND "amountCents" > 0)
    OR ("kind" = 'REDEEM' AND "amountCents" < 0)
    OR ("kind" IN ('REFUND', 'ADJUSTMENT'))
  );

-- --------------------------------------------------------------------------
-- 4. Row-level security on the three new tenant tables
-- --------------------------------------------------------------------------
-- Same policy as every other tenant table, applied by the same rule: if it
-- carries a salonId, it is isolated. Written out per table rather than by
-- re-running the discovery loop, so this migration says plainly which tables
-- it is adding.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['DiscountReason', 'GiftCard', 'GiftCardEntry']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING ("salonId" IS NULL OR "salonId" = current_setting(''app.salon_id'', true)) '
      'WITH CHECK ("salonId" IS NULL OR "salonId" = current_setting(''app.salon_id'', true))',
      t
    );
  END LOOP;
END $$;
