-- Drop sixteen models that nothing could read or write.
--
-- Every table here was declared, migrated, and then touched by no code path in
-- src/, tests/ or the seed: loyalty, packages, retail sales, the messaging
-- conversation store, policies and their acknowledgements, metric snapshots,
-- no-show scores, recurring schedules, invitations, hair condition assessments
-- and appointment photos.
--
-- `Policy` is the one that was actively misleading rather than merely absent:
-- the seed wrote a cancellation policy with a 48-hour window and a 50% fee,
-- and the numbers that actually decide a cancellation fee live on
-- `SalonSettings`, which `assessCancellation` is the only reader of. Two
-- sources for one rule, one of them fiction.
--
-- `RulesetVersion` and `SalonRulesetPin` were candidates and are deliberately
-- KEPT: `consultation.ts` reads the pin to replay a past evaluation against the
-- ruleset it was decided under.
--
-- All sixteen tables are empty in every environment, so this drops no data.

-- AlterEnum
BEGIN;
CREATE TYPE "InvoiceLineKind_new" AS ENUM ('SERVICE', 'RETAIL', 'FEE', 'DISCOUNT', 'DEPOSIT_APPLIED', 'GIFT_CARD', 'TIP');
ALTER TABLE "InvoiceLine" ALTER COLUMN "kind" TYPE "InvoiceLineKind_new" USING ("kind"::text::"InvoiceLineKind_new");
ALTER TYPE "InvoiceLineKind" RENAME TO "InvoiceLineKind_old";
ALTER TYPE "InvoiceLineKind_new" RENAME TO "InvoiceLineKind";
DROP TYPE "public"."InvoiceLineKind_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "AppointmentPhoto" DROP CONSTRAINT "AppointmentPhoto_appointmentId_fkey";

-- DropForeignKey
ALTER TABLE "AppointmentPhoto" DROP CONSTRAINT "AppointmentPhoto_photoAssetId_fkey";

-- DropForeignKey
ALTER TABLE "HairConditionAssessment" DROP CONSTRAINT "HairConditionAssessment_appointmentId_fkey";

-- DropForeignKey
ALTER TABLE "HairConditionAssessment" DROP CONSTRAINT "HairConditionAssessment_clientProfileId_fkey";

-- DropForeignKey
ALTER TABLE "HairConditionAssessment" DROP CONSTRAINT "HairConditionAssessment_consultationId_fkey";

-- DropForeignKey
ALTER TABLE "HairConditionAssessment" DROP CONSTRAINT "HairConditionAssessment_salonId_fkey";

-- DropForeignKey
ALTER TABLE "Invitation" DROP CONSTRAINT "Invitation_salonId_fkey";

-- DropForeignKey
ALTER TABLE "LoyaltyAccount" DROP CONSTRAINT "LoyaltyAccount_clientProfileId_fkey";

-- DropForeignKey
ALTER TABLE "LoyaltyAccount" DROP CONSTRAINT "LoyaltyAccount_salonId_fkey";

-- DropForeignKey
ALTER TABLE "LoyaltyTransaction" DROP CONSTRAINT "LoyaltyTransaction_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_threadId_fkey";

-- DropForeignKey
ALTER TABLE "MessageThread" DROP CONSTRAINT "MessageThread_appointmentId_fkey";

-- DropForeignKey
ALTER TABLE "MessageThread" DROP CONSTRAINT "MessageThread_clientProfileId_fkey";

-- DropForeignKey
ALTER TABLE "MessageThread" DROP CONSTRAINT "MessageThread_salonId_fkey";

-- DropForeignKey
ALTER TABLE "MetricSnapshot" DROP CONSTRAINT "MetricSnapshot_salonId_fkey";

-- DropForeignKey
ALTER TABLE "NoShowScore" DROP CONSTRAINT "NoShowScore_appointmentId_fkey";

-- DropForeignKey
ALTER TABLE "NoShowScore" DROP CONSTRAINT "NoShowScore_clientProfileId_fkey";

-- DropForeignKey
ALTER TABLE "PackageDefinition" DROP CONSTRAINT "PackageDefinition_salonId_fkey";

-- DropForeignKey
ALTER TABLE "PackageDefinition" DROP CONSTRAINT "PackageDefinition_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "PackagePurchase" DROP CONSTRAINT "PackagePurchase_clientProfileId_fkey";

-- DropForeignKey
ALTER TABLE "PackagePurchase" DROP CONSTRAINT "PackagePurchase_packageDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "PackageRedemption" DROP CONSTRAINT "PackageRedemption_appointmentId_fkey";

-- DropForeignKey
ALTER TABLE "PackageRedemption" DROP CONSTRAINT "PackageRedemption_packagePurchaseId_fkey";

-- DropForeignKey
ALTER TABLE "Policy" DROP CONSTRAINT "Policy_salonId_fkey";

-- DropForeignKey
ALTER TABLE "PolicyAcknowledgement" DROP CONSTRAINT "PolicyAcknowledgement_clientProfileId_fkey";

-- DropForeignKey
ALTER TABLE "PolicyAcknowledgement" DROP CONSTRAINT "PolicyAcknowledgement_policyId_fkey";

-- DropForeignKey
ALTER TABLE "RetailSale" DROP CONSTRAINT "RetailSale_appointmentId_fkey";

-- DropForeignKey
ALTER TABLE "RetailSale" DROP CONSTRAINT "RetailSale_productId_fkey";

-- NOTE: `AppointmentSegment.period` is deliberately absent from this file.
--
-- It is a GENERATED column that exists only in SQL, added by
-- 20260802180000_segment_exclusion_and_rls together with the two exclusion
-- constraints that are the actual double-booking guard. Prisma's datamodel
-- cannot express it, so every `migrate diff` in the datamodel direction
-- proposes dropping it — and dropping it takes `segment_stylist_no_overlap`
-- and `segment_resource_no_overlap` with it, which silently turns the diary
-- into one that lets two clients hold the same chair.

-- DropTable
DROP TABLE "AppointmentPhoto";

-- DropTable
DROP TABLE "HairConditionAssessment";

-- DropTable
DROP TABLE "Invitation";

-- DropTable
DROP TABLE "LoyaltyAccount";

-- DropTable
DROP TABLE "LoyaltyTransaction";

-- DropTable
DROP TABLE "Message";

-- DropTable
DROP TABLE "MessageThread";

-- DropTable
DROP TABLE "MetricSnapshot";

-- DropTable
DROP TABLE "NoShowScore";

-- DropTable
DROP TABLE "PackageDefinition";

-- DropTable
DROP TABLE "PackagePurchase";

-- DropTable
DROP TABLE "PackageRedemption";

-- DropTable
DROP TABLE "Policy";

-- DropTable
DROP TABLE "PolicyAcknowledgement";

-- DropTable
DROP TABLE "RecurringSchedule";

-- DropTable
DROP TABLE "RetailSale";

-- DropEnum
DROP TYPE "AppointmentPhotoKind";

-- DropEnum
DROP TYPE "HairCondition";

-- DropEnum
DROP TYPE "MessageAuthor";

-- DropEnum
DROP TYPE "MessageDirection";

-- DropEnum
DROP TYPE "MetricPeriod";

-- DropEnum
DROP TYPE "PolicyType";

-- DropEnum
DROP TYPE "RiskBand";

-- DropEnum
DROP TYPE "ThreadStatus";

