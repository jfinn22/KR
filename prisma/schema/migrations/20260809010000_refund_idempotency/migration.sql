-- Concurrent refunds used to both clear the provider check and both insert a
-- Refund row. The unique key makes the second insert fail closed.
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");
