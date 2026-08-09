-- Retries of outbox.dispatch must not enqueue the same delivery twice.
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookDelivery_endpointId_dedupeKey_key"
  ON "WebhookDelivery"("endpointId", "dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;
