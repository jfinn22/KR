-- Explicit referential actions on every salon-scoped relation.
--
-- Deleting a salon (offboarding, or an erasure request) previously failed on
-- foreign keys: plans referenced services, appointments referenced locations
-- and stylists, and none of those relations declared what should happen. They
-- all cascade now, because a deleted salon means deleted salon data.
--
-- Two relations stay RESTRICT on purpose and are NOT touched here:
-- SalonRulesetPin.ruleset and Subscription.plan both point at global catalogs,
-- where a delete is an incident rather than a cleanup.
--
-- AppointmentSegment."period" is a generated column owned by an earlier
-- migration and is deliberately absent from the Prisma schema; the drop
-- statement Prisma generated for it has been removed.
-- DropForeignKey
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_locationId_fkey";

-- DropForeignKey
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_primaryStylistId_fkey";

-- DropForeignKey
ALTER TABLE "AppointmentSegment" DROP CONSTRAINT "AppointmentSegment_locationId_fkey";

-- DropForeignKey
ALTER TABLE "AppointmentService" DROP CONSTRAINT "AppointmentService_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "AppointmentService" DROP CONSTRAINT "AppointmentService_stylistProfileId_fkey";

-- DropForeignKey
ALTER TABLE "BookingHold" DROP CONSTRAINT "BookingHold_locationId_fkey";

-- DropForeignKey
ALTER TABLE "ClientMembership" DROP CONSTRAINT "ClientMembership_planId_fkey";

-- DropForeignKey
ALTER TABLE "Consultation" DROP CONSTRAINT "Consultation_templateId_fkey";

-- DropForeignKey
ALTER TABLE "FormSubmission" DROP CONSTRAINT "FormSubmission_formTemplateId_fkey";

-- DropForeignKey
ALTER TABLE "Formula" DROP CONSTRAINT "Formula_stylistProfileId_fkey";

-- DropForeignKey
ALTER TABLE "PackagePurchase" DROP CONSTRAINT "PackagePurchase_packageDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "RetailSale" DROP CONSTRAINT "RetailSale_productId_fkey";

-- DropForeignKey
ALTER TABLE "ServicePlan" DROP CONSTRAINT "ServicePlan_stylistProfileId_fkey";

-- DropForeignKey
ALTER TABLE "ServicePlanSessionService" DROP CONSTRAINT "ServicePlanSessionService_serviceId_fkey";

-- AddForeignKey
ALTER TABLE "ClientMembership" ADD CONSTRAINT "ClientMembership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ClientMembershipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagePurchase" ADD CONSTRAINT "PackagePurchase_packageDefinitionId_fkey" FOREIGN KEY ("packageDefinitionId") REFERENCES "PackageDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailSale" ADD CONSTRAINT "RetailSale_productId_fkey" FOREIGN KEY ("productId") REFERENCES "RetailProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formTemplateId_fkey" FOREIGN KEY ("formTemplateId") REFERENCES "FormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ConsultationTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlan" ADD CONSTRAINT "ServicePlan_stylistProfileId_fkey" FOREIGN KEY ("stylistProfileId") REFERENCES "StylistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlanSessionService" ADD CONSTRAINT "ServicePlanSessionService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Formula" ADD CONSTRAINT "Formula_stylistProfileId_fkey" FOREIGN KEY ("stylistProfileId") REFERENCES "StylistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_primaryStylistId_fkey" FOREIGN KEY ("primaryStylistId") REFERENCES "StylistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_stylistProfileId_fkey" FOREIGN KEY ("stylistProfileId") REFERENCES "StylistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSegment" ADD CONSTRAINT "AppointmentSegment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
