-- Outbound webhooks and mirrored external calendar commitments.
--
-- Hand-written rather than generated. `prisma migrate diff` in the datamodel
-- direction always proposes dropping AppointmentSegment."period", which is a
-- generated tstzrange that only exists in SQL and carries both double-booking
-- exclusion constraints. Applying that would silently remove the guarantee
-- that two clients cannot be given the same stylist at the same time.

CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "topics" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastDeliveredAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseCode" INTEGER,
    "error" TEXT,
    "deliveredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalBusy" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "stylistProfileId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "source" TEXT NOT NULL,
    "syncedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalBusy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookEndpoint_salonId_isActive_idx" ON "WebhookEndpoint"("salonId", "isActive");
CREATE INDEX "WebhookDelivery_salonId_status_createdAt_idx" ON "WebhookDelivery"("salonId", "status", "createdAt");
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");
CREATE INDEX "ExternalBusy_salonId_stylistProfileId_startsAt_idx" ON "ExternalBusy"("salonId", "stylistProfileId", "startsAt");
CREATE INDEX "ExternalBusy_salonId_source_idx" ON "ExternalBusy"("salonId", "source");

ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalBusy" ADD CONSTRAINT "ExternalBusy_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalBusy" ADD CONSTRAINT "ExternalBusy_stylistProfileId_fkey" FOREIGN KEY ("stylistProfileId") REFERENCES "StylistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, matching every other tenant-scoped table.
ALTER TABLE "WebhookEndpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExternalBusy" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "WebhookEndpoint"
  USING ("salonId" = current_setting('app.salon_id', true));
CREATE POLICY tenant_isolation ON "WebhookDelivery"
  USING ("salonId" = current_setting('app.salon_id', true));
CREATE POLICY tenant_isolation ON "ExternalBusy"
  USING ("salonId" = current_setting('app.salon_id', true));
