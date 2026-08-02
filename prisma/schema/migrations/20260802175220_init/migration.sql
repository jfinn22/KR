-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateEnum
CREATE TYPE "PriceModel" AS ENUM ('FIXED', 'FROM', 'QUOTE_ONLY');

-- CreateEnum
CREATE TYPE "PhaseKind" AS ENUM ('ACTIVE', 'PROCESSING', 'RINSE', 'CONSULT');

-- CreateEnum
CREATE TYPE "DepositMode" AS ENUM ('NONE', 'FLAT', 'PERCENT', 'TIERED');

-- CreateEnum
CREATE TYPE "ModifierFactor" AS ENUM ('HAIR_LENGTH', 'DENSITY', 'TEXTURE', 'CURL_PATTERN', 'GREY_PERCENT', 'EXTENSION_ROWS');

-- CreateEnum
CREATE TYPE "ModifierTarget" AS ENUM ('DURATION', 'PRICE', 'BOTH');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'CAPTURED', 'APPLIED', 'REFUNDED', 'FORFEITED', 'FAILED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'PARTIALLY_PAID', 'VOID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "InvoiceLineKind" AS ENUM ('SERVICE', 'RETAIL', 'FEE', 'DISCOUNT', 'DEPOSIT_APPLIED', 'PACKAGE_REDEMPTION', 'GIFT_CARD', 'TIP');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'TERMINAL', 'CASH', 'ACCOUNT_CREDIT', 'GIFT_CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "FeeStatus" AS ENUM ('PENDING', 'CHARGED', 'WAIVED', 'FAILED');

-- CreateEnum
CREATE TYPE "ClientMembershipStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'PAUSED');

-- CreateEnum
CREATE TYPE "ProductRecStatus" AS ENUM ('RECOMMENDED', 'PURCHASED', 'DECLINED');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('SMS', 'EMAIL', 'IN_APP', 'PUSH');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageAuthor" AS ENUM ('CLIENT', 'STAFF', 'SYSTEM', 'AI_DRAFT');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('OPEN', 'SNOOZED', 'CLOSED');

-- CreateEnum
CREATE TYPE "NotificationTrigger" AS ENUM ('APPOINTMENT_BEFORE', 'APPOINTMENT_AFTER', 'CONSULT_STALE', 'CONSULT_DECISION', 'PLAN_EXPIRING', 'PATCH_TEST_DUE', 'REBOOK_DUE', 'FORM_INCOMPLETE', 'DEPOSIT_DUE', 'WAITLIST_OFFER');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('TRANSACTIONAL', 'MARKETING');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('BOUNCE', 'COMPLAINT', 'UNSUBSCRIBE', 'MANUAL');

-- CreateEnum
CREATE TYPE "FormKind" AS ENUM ('CONSENT', 'WAIVER', 'INTAKE', 'POLICY', 'PHOTO_RELEASE', 'PATCH_TEST', 'MINOR_GUARDIAN', 'CHEMICAL_SERVICE', 'EXTENSION', 'CORRECTION_SERVICE');

-- CreateEnum
CREATE TYPE "SignatureMethod" AS ENUM ('DRAWN', 'TYPED', 'CLICKWRAP');

-- CreateEnum
CREATE TYPE "TestResult" AS ENUM ('PENDING', 'NEGATIVE', 'POSITIVE', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "StrandDecision" AS ENUM ('PROCEED', 'MODIFY', 'ABORT');

-- CreateEnum
CREATE TYPE "GrantKind" AS ENUM ('PHOTO_RELEASE', 'MARKETING_USE', 'SMS', 'EMAIL', 'DATA_PROCESSING', 'AI_PHOTO_ANALYSIS', 'MINOR_GUARDIAN', 'CHEMICAL_SERVICE', 'EXTENSIONS', 'CORRECTION_SERVICE');

-- CreateEnum
CREATE TYPE "PolicyType" AS ENUM ('CANCELLATION', 'NO_SHOW', 'DEPOSIT_FORFEITURE', 'RESCHEDULE', 'PHOTO_USAGE', 'LATE_ARRIVAL', 'MINORS');

-- CreateEnum
CREATE TYPE "ConsultationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'NEEDS_MORE_INFO', 'NEEDS_IN_PERSON', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ConsultationMode" AS ENUM ('DIGITAL', 'PHOTO', 'VIDEO', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QuestionInput" AS ENUM ('SINGLE_SELECT', 'MULTI_SELECT', 'BOOLEAN', 'NUMBER', 'TEXT', 'LONG_TEXT', 'DATE', 'SCALE', 'LEVEL_PICKER', 'PHOTO_PROMPT');

-- CreateEnum
CREATE TYPE "PhotoView" AS ENUM ('FRONT', 'BACK', 'LEFT', 'RIGHT', 'ROOTS', 'MIDS', 'ENDS', 'TEXTURE', 'WET', 'SCALP', 'PART', 'OTHER');

-- CreateEnum
CREATE TYPE "InspirationKey" AS ENUM ('TARGET_LEVEL', 'TARGET_TONE', 'TECHNIQUE', 'ROOT_SHADOW', 'CONTRAST', 'DIMENSION', 'BRIGHTNESS', 'CURLS', 'LENGTH', 'FRINGE', 'LAYERS', 'MAINTENANCE', 'OVERALL_VIBE');

-- CreateEnum
CREATE TYPE "AttributeSource" AS ENUM ('CLIENT', 'STYLIST', 'AI');

-- CreateEnum
CREATE TYPE "FlagSeverity" AS ENUM ('INFO', 'CAUTION', 'HIGH', 'BLOCKER');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'OVERRIDDEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVE', 'APPROVE_WITH_CHANGES', 'REQUEST_IN_PERSON', 'REQUEST_MORE_PHOTOS', 'REQUEST_MORE_INFO', 'DECLINE');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_BOOKED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PLANNED', 'BOOKED', 'COMPLETED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequirementKind" AS ENUM ('PATCH_TEST', 'STRAND_TEST', 'IN_PERSON_CONSULT', 'FORM_SIGNATURE', 'PHOTO_RESUBMIT', 'DEPOSIT', 'TREATMENT_COURSE');

-- CreateEnum
CREATE TYPE "RequirementDue" AS ENUM ('BOOKING', 'SESSION');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('PENDING', 'SATISFIED', 'WAIVED', 'FAILED');

-- CreateEnum
CREATE TYPE "EvaluationTrigger" AS ENUM ('SUBMIT', 'RE_EVALUATE', 'FACT_ACCEPTED', 'STAFF_EDIT', 'REPLAY');

-- CreateEnum
CREATE TYPE "Texture" AS ENUM ('FINE', 'MEDIUM', 'COARSE');

-- CreateEnum
CREATE TYPE "Density" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "Porosity" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "Elasticity" AS ENUM ('POOR', 'FAIR', 'GOOD');

-- CreateEnum
CREATE TYPE "LengthCategory" AS ENUM ('PIXIE', 'CHIN', 'SHOULDER', 'COLLARBONE', 'MID_BACK', 'WAIST', 'HIP');

-- CreateEnum
CREATE TYPE "ScalpCondition" AS ENUM ('NORMAL', 'DRY', 'OILY', 'FLAKY', 'IRRITATED', 'PSORIASIS', 'ECZEMA');

-- CreateEnum
CREATE TYPE "Sensitivity" AS ENUM ('NONE', 'MILD', 'MODERATE', 'SEVERE');

-- CreateEnum
CREATE TYPE "HairEventType" AS ENUM ('SELF_REPORTED_HISTORY', 'CONSULTATION', 'SERVICE', 'FORMULA', 'CONDITION_ASSESSMENT', 'PHOTO', 'AT_HOME_TREATMENT', 'INCIDENT', 'NOTE', 'PLAN_APPROVED');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('CLIENT', 'STYLIST', 'SYSTEM', 'AI_ACCEPTED');

-- CreateEnum
CREATE TYPE "HairCondition" AS ENUM ('IMPROVING', 'STABLE', 'OVERPROCESSED', 'DRY', 'FRAGILE', 'RECOVERING');

-- CreateEnum
CREATE TYPE "FormulaPurpose" AS ENUM ('GLOBAL_COLOR', 'ROOT_TOUCH_UP', 'LIGHTENER', 'TONER', 'GLOSS', 'LOWLIGHT', 'TREATMENT', 'PERM', 'RELAXER', 'SMOOTHING');

-- CreateEnum
CREATE TYPE "FormulaRole" AS ENUM ('BASE', 'TONE', 'ADDITIVE', 'BOND_BUILDER', 'DEVELOPER', 'CLEAR');

-- CreateEnum
CREATE TYPE "AppointmentPhotoKind" AS ENUM ('BEFORE', 'PROGRESS', 'AFTER', 'STRAND_TEST', 'PATCH_TEST');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'JOB', 'AI', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MetricPeriod" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "RiskBand" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AiKind" AS ENUM ('CONSULTATION_SUMMARY', 'PHOTO_ANALYSIS', 'INSPIRATION_ATTRIBUTES', 'RISK_EXPLAIN', 'PLAN_NARRATIVE', 'MESSAGE_DRAFT', 'FORMULA_SUGGEST', 'INTAKE_NORMALIZE', 'SEGMENTATION');

-- CreateEnum
CREATE TYPE "AiStatus" AS ENUM ('DRAFT', 'ACCEPTED', 'EDITED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('GOOGLE_CALENDAR', 'APPLE_ICAL', 'STRIPE', 'TWILIO', 'RESEND', 'SQUARE_POS', 'QUICKBOOKS', 'MAILCHIMP', 'INSTAGRAM', 'FACEBOOK', 'GOOGLE_BUSINESS');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_CHAIR', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('CLIENT_PORTAL', 'FRONT_DESK', 'WAITLIST', 'REBOOK', 'IMPORT');

-- CreateEnum
CREATE TYPE "SegmentKind" AS ENUM ('BUFFER_BEFORE', 'ACTIVE', 'PROCESSING', 'RINSE', 'BUFFER_AFTER', 'BLOCK');

-- CreateEnum
CREATE TYPE "SegmentState" AS ENUM ('ACTIVE', 'HOLD', 'RELEASED');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED', 'RELEASED');

-- CreateEnum
CREATE TYPE "TimeOffStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DENIED');

-- CreateEnum
CREATE TYPE "ExceptionKind" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('OPEN', 'OFFERED', 'BOOKED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('STARTER', 'PRO', 'SALON');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'PAUSED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'MANAGER', 'FRONT_DESK', 'STYLIST', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('CHAIR', 'BASIN', 'PROCESSING_SEAT', 'ROOM', 'DRYER');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'MERGED');

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "colorHex" TEXT NOT NULL DEFAULT '#C9A227',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isChemical" BOOLEAN NOT NULL DEFAULT false,
    "isLightening" BOOLEAN NOT NULL DEFAULT false,
    "containsDye" BOOLEAN NOT NULL DEFAULT false,
    "isExtensionInstall" BOOLEAN NOT NULL DEFAULT false,
    "requiresConsultation" BOOLEAN NOT NULL DEFAULT false,
    "consultationTemplateKey" TEXT,
    "requiresPatchTest" BOOLEAN NOT NULL DEFAULT false,
    "patchTestLeadHours" INTEGER NOT NULL DEFAULT 48,
    "basePriceCents" INTEGER NOT NULL DEFAULT 0,
    "priceModel" "PriceModel" NOT NULL DEFAULT 'FIXED',
    "baseComplexity" INTEGER NOT NULL DEFAULT 0,
    "bufferBeforeMin" INTEGER,
    "bufferAfterMin" INTEGER,
    "requiredSkillCode" TEXT,
    "requiredSkillLevel" INTEGER,
    "allowInterleaveDuringProcessing" BOOLEAN NOT NULL DEFAULT true,
    "depositPolicyId" TEXT,
    "isBookableOnline" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePhase" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "PhaseKind" NOT NULL,
    "label" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "requiresStylist" BOOLEAN NOT NULL DEFAULT true,
    "requiresResourceType" "ResourceType",
    "isScalable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ServicePhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceVariant" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "durationDeltaMin" INTEGER NOT NULL DEFAULT 0,
    "priceDeltaCents" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ServiceVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StylistService" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "stylistProfileId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "durationMultiplier" DECIMAL(4,3),
    "durationOverrideMin" INTEGER,
    "priceOverrideCents" INTEGER,
    "notes" TEXT,

    CONSTRAINT "StylistService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceModifier" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "serviceId" TEXT,
    "categoryId" TEXT,
    "factorKey" "ModifierFactor" NOT NULL,
    "factorValue" TEXT NOT NULL,
    "deltaMin" INTEGER NOT NULL DEFAULT 0,
    "deltaPercentBps" INTEGER NOT NULL DEFAULT 0,
    "deltaPriceCents" INTEGER NOT NULL DEFAULT 0,
    "appliesTo" "ModifierTarget" NOT NULL DEFAULT 'DURATION',

    CONSTRAINT "ServiceModifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositPolicy" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "DepositMode" NOT NULL DEFAULT 'PERCENT',
    "flatCents" INTEGER,
    "percentBps" INTEGER,
    "minCents" INTEGER NOT NULL DEFAULT 0,
    "maxCents" INTEGER,
    "tiersJson" JSONB,
    "refundableUntilHours" INTEGER NOT NULL DEFAULT 48,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DepositPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "servicePlanId" TEXT,
    "appointmentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "providerIntentId" TEXT,
    "authorizationExpiresAt" TIMESTAMPTZ(3),
    "appliedToPaymentId" TEXT,
    "policySnapshotJson" JSONB,
    "refundableUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "clientProfileId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "tipCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMPTZ(3),
    "paidAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" "InvoiceLineKind" NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "appointmentId" TEXT,
    "clientProfileId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "tipCents" INTEGER NOT NULL DEFAULT 0,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CARD',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "providerRef" TEXT,
    "idempotencyKey" TEXT,
    "failureCode" TEXT,
    "capturedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "providerRef" TEXT,
    "issuedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationFee" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "policySnapshotJson" JSONB NOT NULL,
    "computedCents" INTEGER NOT NULL,
    "chargedCents" INTEGER NOT NULL DEFAULT 0,
    "status" "FeeStatus" NOT NULL DEFAULT 'PENDING',
    "waivedByUserId" TEXT,
    "waiveReason" TEXT,
    "paymentId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CancellationFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyAccount" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'STANDARD',
    "lifetimeSpendCents" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyTransaction" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientMembershipPlan" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "descriptionText" TEXT,
    "priceCents" INTEGER NOT NULL,
    "interval" TEXT NOT NULL DEFAULT 'MONTH',
    "includedJson" JSONB,
    "stripePriceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ClientMembershipPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientMembership" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "ClientMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewsAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "creditsRemaining" INTEGER NOT NULL DEFAULT 0,
    "stripeSubscriptionId" TEXT,

    CONSTRAINT "ClientMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageDefinition" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "sessionsIncluded" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "expiresInDays" INTEGER NOT NULL DEFAULT 365,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PackageDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagePurchase" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "packageDefinitionId" TEXT NOT NULL,
    "sessionsRemaining" INTEGER NOT NULL,
    "purchasedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "invoiceId" TEXT,

    CONSTRAINT "PackagePurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageRedemption" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "packagePurchaseId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "redeemedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailProduct" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "category" TEXT,
    "priceCents" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "attributesJson" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RetailProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailSale" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "invoiceLineId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceCents" INTEGER NOT NULL,
    "soldAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductUsage" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT,
    "grams" DECIMAL(7,1) NOT NULL,
    "wasteGrams" DECIMAL(7,1) NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRecommendation" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "retailProductId" TEXT NOT NULL,
    "recommendedByUserId" TEXT,
    "reason" TEXT,
    "status" "ProductRecStatus" NOT NULL DEFAULT 'RECOMMENDED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageThread" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "subject" TEXT,
    "primaryChannel" "MessageChannel" NOT NULL DEFAULT 'IN_APP',
    "status" "ThreadStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToUserId" TEXT,
    "appointmentId" TEXT,
    "consultationId" TEXT,
    "lastMessageAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "authorType" "MessageAuthor" NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "attachmentsJson" JSONB,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "failureReason" TEXT,
    "aiSuggestionId" TEXT,
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "salonId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "channel" "MessageChannel" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSchedule" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "trigger" "NotificationTrigger" NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "templateId" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'CLIENT',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledNotification" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "clientProfileId" TEXT NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "sendAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "jobId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactConsent" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'GRANTED',
    "capturedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedVia" TEXT,
    "ipAddress" TEXT,
    "proofJson" JSONB,
    "quietHoursStart" INTEGER,
    "quietHoursEnd" INTEGER,

    CONSTRAINT "ContactConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionEntry" (
    "id" TEXT NOT NULL,
    "salonId" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "address" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevOutbox" (
    "id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "metaJson" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormTemplate" (
    "id" TEXT NOT NULL,
    "salonId" TEXT,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "kind" "FormKind" NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "schemaJson" JSONB,
    "requiresSignature" BOOLEAN NOT NULL DEFAULT true,
    "validForDays" INTEGER,
    "appliesToServiceIds" TEXT[],
    "isLegalPlaceholder" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "formTemplateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "consultationId" TEXT,
    "servicePlanId" TEXT,
    "answersJson" JSONB,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "documentHash" TEXT NOT NULL,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "formSubmissionId" TEXT NOT NULL,
    "signerUserId" TEXT,
    "signerName" TEXT NOT NULL,
    "signerRelationship" TEXT,
    "method" "SignatureMethod" NOT NULL DEFAULT 'DRAWN',
    "imageStorageKey" TEXT,
    "documentHash" TEXT NOT NULL,
    "signedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatchTest" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "servicePlanId" TEXT,
    "productBrand" TEXT,
    "productRef" TEXT,
    "appliedAt" TIMESTAMPTZ(3) NOT NULL,
    "appliedByUserId" TEXT,
    "readAt" TIMESTAMPTZ(3),
    "result" "TestResult" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "photoAssetId" TEXT,
    "validUntil" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatchTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrandTest" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "consultationId" TEXT,
    "servicePlanId" TEXT,
    "formulaId" TEXT,
    "performedAt" TIMESTAMPTZ(3) NOT NULL,
    "performedByUserId" TEXT NOT NULL,
    "startLevel" INTEGER,
    "liftAchievedLevel" INTEGER,
    "integrityAfter" "Elasticity",
    "resultNotes" TEXT,
    "photoAssetIds" TEXT[],
    "decision" "StrandDecision" NOT NULL DEFAULT 'PROCEED',

    CONSTRAINT "StrandTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentGrant" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "kind" "GrantKind" NOT NULL,
    "scope" TEXT,
    "status" "ConsentStatus" NOT NULL DEFAULT 'GRANTED',
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "evidenceFormSubmissionId" TEXT,

    CONSTRAINT "ConsentGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "type" "PolicyType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "bodyMarkdown" TEXT NOT NULL,
    "configJson" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyAcknowledgement" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "acknowledgedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,

    CONSTRAINT "PolicyAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationTemplate" (
    "id" TEXT NOT NULL,
    "salonId" TEXT,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "descriptionText" TEXT,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "appliesToServiceIds" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationQuestion" (
    "id" TEXT NOT NULL,
    "salonId" TEXT,
    "templateId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "helpText" TEXT,
    "inputType" "QuestionInput" NOT NULL,
    "optionsJson" JSONB,
    "validationJson" JSONB,
    "factKey" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "visibleWhenJson" JSONB,

    CONSTRAINT "ConsultationQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consultation" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "requestedServiceIds" TEXT[],
    "requestedStylistId" TEXT,
    "preferredLocationId" TEXT,
    "status" "ConsultationStatus" NOT NULL DEFAULT 'DRAFT',
    "mode" "ConsultationMode" NOT NULL DEFAULT 'DIGITAL',
    "submittedAt" TIMESTAMPTZ(3),
    "slaDueAt" TIMESTAMPTZ(3),
    "reviewedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "rulesetVersion" TEXT,
    "latestEvaluationId" TEXT,
    "factsSnapshotJson" JSONB,
    "aiSuggestionJson" JSONB,
    "clientNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Consultation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationAnswer" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "answeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoAsset" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "sha256" TEXT,
    "capturedAt" TIMESTAMPTZ(3),
    "uploadedByUserId" TEXT,
    "exifStripped" BOOLEAN NOT NULL DEFAULT false,
    "isClientVisible" BOOLEAN NOT NULL DEFAULT true,
    "isMarketingApproved" BOOLEAN NOT NULL DEFAULT false,
    "consentGrantId" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationPhoto" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "photoAssetId" TEXT NOT NULL,
    "view" "PhotoView" NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "qualityScore" DECIMAL(4,3),
    "qualityIssues" TEXT[],
    "isApprovedForRecord" BOOLEAN NOT NULL DEFAULT false,
    "aiObservationsJson" JSONB,

    CONSTRAINT "ConsultationPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspirationPhoto" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "photoAssetId" TEXT,
    "sourceUrl" TEXT,
    "clientNote" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InspirationPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspirationAttribute" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "inspirationPhotoId" TEXT NOT NULL,
    "key" "InspirationKey" NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DECIMAL(4,3),
    "source" "AttributeSource" NOT NULL DEFAULT 'CLIENT',
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMPTZ(3),

    CONSTRAINT "InspirationAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleEvaluation" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "consultationId" TEXT,
    "servicePlanId" TEXT,
    "rulesetVersion" TEXT NOT NULL,
    "rulesetHash" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "inputSnapshotJson" JSONB NOT NULL,
    "outputSnapshotJson" JSONB NOT NULL,
    "engineMs" INTEGER NOT NULL DEFAULT 0,
    "triggeredBy" "EvaluationTrigger" NOT NULL DEFAULT 'SUBMIT',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskFlag" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "severity" "FlagSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "evidenceJson" JSONB NOT NULL,
    "recommendedPath" TEXT NOT NULL,
    "blocksOnlineBooking" BOOLEAN NOT NULL DEFAULT false,
    "status" "FlagStatus" NOT NULL DEFAULT 'OPEN',
    "overriddenByUserId" TEXT,
    "overrideReason" TEXT,
    "overriddenAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationReview" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "notesInternal" TEXT,
    "notesToClient" TEXT,
    "aiSuggestionId" TEXT,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePlan" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "stylistProfileId" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "totalSessions" INTEGER NOT NULL DEFAULT 1,
    "complexityScore" INTEGER NOT NULL DEFAULT 0,
    "riskLevel" "FlagSeverity" NOT NULL DEFAULT 'INFO',
    "estimatedTotalMin" INTEGER NOT NULL,
    "estimatedTotalCents" INTEGER NOT NULL,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "depositPolicyId" TEXT,
    "depositPolicySnapshotJson" JSONB,
    "rulesetVersion" TEXT NOT NULL,
    "evaluationId" TEXT,
    "requiresStylistContinuity" BOOLEAN NOT NULL DEFAULT false,
    "notesToClient" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "validUntil" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ServicePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePlanSession" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "servicePlanId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "goalSummary" TEXT,
    "estimatedDurationMin" INTEGER NOT NULL,
    "estimatedPriceCents" INTEGER NOT NULL,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "minDaysAfterPrevious" INTEGER,
    "maxDaysAfterPrevious" INTEGER,
    "status" "SessionStatus" NOT NULL DEFAULT 'PLANNED',

    CONSTRAINT "ServicePlanSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePlanSessionService" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "serviceVariantId" TEXT,
    "sequence" INTEGER NOT NULL,
    "plannedDurationMin" INTEGER NOT NULL,
    "plannedPriceCents" INTEGER NOT NULL,
    "phaseChainJson" JSONB NOT NULL,

    CONSTRAINT "ServicePlanSessionService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreRequirement" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "servicePlanId" TEXT,
    "consultationId" TEXT,
    "kind" "RequirementKind" NOT NULL,
    "dueBefore" "RequirementDue" NOT NULL DEFAULT 'BOOKING',
    "sessionSequence" INTEGER,
    "leadHours" INTEGER,
    "formTemplateKey" TEXT,
    "rationale" TEXT NOT NULL,
    "status" "RequirementStatus" NOT NULL DEFAULT 'PENDING',
    "satisfiedByType" TEXT,
    "satisfiedById" TEXT,
    "satisfiedAt" TIMESTAMPTZ(3),
    "waivedByUserId" TEXT,
    "waiveReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HairProfile" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "naturalLevel" INTEGER,
    "currentLevelRoots" INTEGER,
    "currentLevelMids" INTEGER,
    "currentLevelEnds" INTEGER,
    "toneRoots" TEXT,
    "toneMids" TEXT,
    "toneEnds" TEXT,
    "undertone" TEXT,
    "texture" "Texture",
    "density" "Density",
    "curlPattern" TEXT,
    "porosity" "Porosity",
    "elasticity" "Elasticity",
    "integrityScore" INTEGER,
    "lengthCategory" "LengthCategory",
    "greyPercent" INTEGER,
    "greyResistant" BOOLEAN,
    "scalpCondition" "ScalpCondition" NOT NULL DEFAULT 'NORMAL',
    "scalpSensitivity" "Sensitivity" NOT NULL DEFAULT 'NONE',
    "hasBoxDye" BOOLEAN NOT NULL DEFAULT false,
    "boxDyeLastAt" DATE,
    "boxDyeDarkOrBlack" BOOLEAN NOT NULL DEFAULT false,
    "hasHenna" BOOLEAN NOT NULL DEFAULT false,
    "hennaLastAt" DATE,
    "hennaProductKnown" BOOLEAN NOT NULL DEFAULT false,
    "hasBleach" BOOLEAN NOT NULL DEFAULT false,
    "bleachSessions12mo" INTEGER NOT NULL DEFAULT 0,
    "bleachMaxLevelAchieved" INTEGER,
    "hasKeratin" BOOLEAN NOT NULL DEFAULT false,
    "keratinLastAt" DATE,
    "hasRelaxer" BOOLEAN NOT NULL DEFAULT false,
    "relaxerLastAt" DATE,
    "hasPerm" BOOLEAN NOT NULL DEFAULT false,
    "permLastAt" DATE,
    "hasExtensions" BOOLEAN NOT NULL DEFAULT false,
    "extensionMethod" TEXT,
    "lastChemicalServiceAt" DATE,
    "breakageReported" BOOLEAN NOT NULL DEFAULT false,
    "gumminessReported" BOOLEAN NOT NULL DEFAULT false,
    "sheddingReported" BOOLEAN NOT NULL DEFAULT false,
    "splitEnds" TEXT NOT NULL DEFAULT 'none',
    "allergiesJson" JSONB,
    "medicationsJson" JSONB,
    "priorReactionToColor" BOOLEAN NOT NULL DEFAULT false,
    "isPregnantOrNursing" BOOLEAN,
    "swimsChlorinatedWeekly" BOOLEAN NOT NULL DEFAULT false,
    "hardWater" BOOLEAN NOT NULL DEFAULT false,
    "heatStylingPerWeek" INTEGER NOT NULL DEFAULT 0,
    "washesPerWeek" INTEGER NOT NULL DEFAULT 3,
    "usesPurpleShampoo" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceAppetite" TEXT NOT NULL DEFAULT 'MEDIUM',
    "homeCareJson" JSONB,
    "updatedFromConsultationId" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "HairProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HairHistoryEvent" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "type" "HairEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "payloadJson" JSONB,
    "appointmentId" TEXT,
    "consultationId" TEXT,
    "formulaId" TEXT,
    "photoAssetIds" TEXT[],
    "source" "EventSource" NOT NULL DEFAULT 'STYLIST',
    "createdByUserId" TEXT,
    "supersedesEventId" TEXT,
    "isClientVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HairHistoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Formula" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "stylistProfileId" TEXT NOT NULL,
    "name" TEXT,
    "purpose" "FormulaPurpose" NOT NULL,
    "developerVolume" INTEGER,
    "ratio" TEXT,
    "processingTimeMin" INTEGER,
    "heatUsed" BOOLEAN NOT NULL DEFAULT false,
    "sectioning" TEXT,
    "technique" TEXT,
    "applicationNotes" TEXT,
    "resultRating" INTEGER,
    "resultNotes" TEXT,
    "outcome" TEXT,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "supersedesFormulaId" TEXT,
    "aiSuggestionId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Formula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormulaComponent" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "formulaId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "retailProductId" TEXT,
    "brand" TEXT,
    "productName" TEXT,
    "shadeCode" TEXT,
    "level" DECIMAL(4,2),
    "tone" TEXT,
    "parts" DECIMAL(5,2),
    "grams" DECIMAL(6,1),
    "developerVolume" INTEGER,
    "role" "FormulaRole" NOT NULL DEFAULT 'BASE',

    CONSTRAINT "FormulaComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HairConditionAssessment" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "consultationId" TEXT,
    "assessedByUserId" TEXT NOT NULL,
    "assessedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "condition" "HairCondition" NOT NULL,
    "porosity" "Porosity",
    "elasticity" "Elasticity",
    "integrityScore" INTEGER,
    "breakageObserved" BOOLEAN NOT NULL DEFAULT false,
    "bandingObserved" BOOLEAN NOT NULL DEFAULT false,
    "scalpScore" INTEGER,
    "notes" TEXT,
    "photoAssetIds" TEXT[],

    CONSTRAINT "HairConditionAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentPhoto" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "photoAssetId" TEXT NOT NULL,
    "kind" "AppointmentPhotoKind" NOT NULL,
    "view" "PhotoView",
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AppointmentPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "salonId" TEXT,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteAccuracy" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "servicePlanId" TEXT,
    "stylistProfileId" TEXT NOT NULL,
    "serviceIds" TEXT[],
    "rulesetVersion" TEXT,
    "complexityScore" INTEGER NOT NULL DEFAULT 0,
    "estimatedDurationMin" INTEGER NOT NULL,
    "actualDurationMin" INTEGER NOT NULL,
    "estimatedPriceCents" INTEGER NOT NULL,
    "actualPriceCents" INTEGER NOT NULL,
    "overranByMin" INTEGER NOT NULL DEFAULT 0,
    "requiredInterleave" BOOLEAN NOT NULL DEFAULT false,
    "factorsSnapshotJson" JSONB,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteAccuracy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StylistCalibration" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "stylistProfileId" TEXT NOT NULL,
    "serviceId" TEXT,
    "sampleCount" INTEGER NOT NULL,
    "medianRatio" DECIMAL(5,3) NOT NULL,
    "p90Ratio" DECIMAL(5,3),
    "shrunkFactor" DECIMAL(5,3) NOT NULL,
    "manualOverride" DECIMAL(5,3),
    "windowStart" DATE NOT NULL,
    "windowEnd" DATE NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StylistCalibration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "locationId" TEXT,
    "stylistProfileId" TEXT,
    "period" "MetricPeriod" NOT NULL,
    "periodStart" DATE NOT NULL,
    "metricKey" TEXT NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "dimensionHash" TEXT NOT NULL DEFAULT '',
    "dimensionsJson" JSONB,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoShowScore" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "score" DECIMAL(4,3) NOT NULL,
    "band" "RiskBand" NOT NULL,
    "featuresJson" JSONB,
    "modelVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoShowScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "kind" "AiKind" NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "rawResponseJson" JSONB,
    "parsedJson" JSONB,
    "editedJson" JSONB,
    "status" "AiStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageCounter" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "period" DATE NOT NULL,
    "tokensIn" BIGINT NOT NULL DEFAULT 0,
    "tokensOut" BIGINT NOT NULL DEFAULT 0,
    "costMicros" BIGINT NOT NULL DEFAULT 0,
    "callCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiUsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "salonId" TEXT,
    "queue" TEXT NOT NULL DEFAULT 'default',
    "type" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "runAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "lockedAt" TIMESTAMPTZ(3),
    "lockedBy" TEXT,
    "dedupeKey" TEXT,
    "traceId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringSchedule" (
    "key" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "payloadJson" JSONB,
    "salonId" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMPTZ(3),
    "nextRunAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RecurringSchedule_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" TEXT NOT NULL,
    "salonId" TEXT,
    "topic" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "salonId" TEXT,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "responseJson" JSONB,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RulesetVersion" (
    "version" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "gitSha" TEXT,
    "notes" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RulesetVersion_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "SalonRulesetPin" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "rulesetVersion" TEXT NOT NULL,
    "pinnedByUserId" TEXT,
    "reason" TEXT,
    "pinnedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalonRulesetPin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonRuleOverride" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "severityFloor" "FlagSeverity",
    "reason" TEXT,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SalonRuleOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "stylistProfileId" TEXT,
    "externalAccountId" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMPTZ(3),
    "scopes" TEXT[],
    "settingsJson" JSONB,
    "syncToken" TEXT,
    "lastSyncedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkingHours" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "locationId" TEXT,
    "stylistProfileId" TEXT,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" DATE,

    CONSTRAINT "WorkingHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleException" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "locationId" TEXT,
    "stylistProfileId" TEXT,
    "date" DATE NOT NULL,
    "kind" "ExceptionKind" NOT NULL,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "reason" TEXT,

    CONSTRAINT "ScheduleException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeOff" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "stylistProfileId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "status" "TimeOffStatus" NOT NULL DEFAULT 'REQUESTED',
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "primaryStylistId" TEXT NOT NULL,
    "servicePlanId" TEXT,
    "servicePlanSessionId" TEXT,
    "consultationId" TEXT,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "source" "AppointmentSource" NOT NULL DEFAULT 'CLIENT_PORTAL',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "checkedInAt" TIMESTAMPTZ(3),
    "chairStartedAt" TIMESTAMPTZ(3),
    "chairEndedAt" TIMESTAMPTZ(3),
    "checkedOutAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" TEXT,
    "cancelledByUserId" TEXT,
    "noShowAt" TIMESTAMPTZ(3),
    "estimatedDurationMin" INTEGER NOT NULL,
    "estimatedTotalCents" INTEGER NOT NULL DEFAULT 0,
    "actualTotalCents" INTEGER,
    "clientNote" TEXT,
    "internalNote" TEXT,
    "checkInToken" TEXT,
    "createdByUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentService" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "serviceVariantId" TEXT,
    "stylistProfileId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "plannedDurationMin" INTEGER NOT NULL,
    "actualDurationMin" INTEGER,
    "priceCents" INTEGER NOT NULL,
    "depositAppliedCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AppointmentService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentSegment" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "appointmentServiceId" TEXT,
    "bookingHoldId" TEXT,
    "stylistProfileId" TEXT,
    "resourceId" TEXT,
    "kind" "SegmentKind" NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "blocksStylist" BOOLEAN NOT NULL DEFAULT true,
    "blocksResource" BOOLEAN NOT NULL DEFAULT false,
    "state" "SegmentState" NOT NULL DEFAULT 'ACTIVE',
    "holdExpiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingHold" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "clientProfileId" TEXT,
    "primaryStylistId" TEXT NOT NULL,
    "servicePlanId" TEXT,
    "servicePlanSessionId" TEXT,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "createdByUserId" TEXT,
    "idempotencyKey" TEXT,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "servicePlanId" TEXT,
    "serviceIds" TEXT[],
    "preferredStylistIds" TEXT[],
    "anyStylist" BOOLEAN NOT NULL DEFAULT true,
    "requiredDurationMin" INTEGER NOT NULL,
    "earliestDate" DATE NOT NULL,
    "latestDate" DATE NOT NULL,
    "dayOfWeekMask" INTEGER NOT NULL DEFAULT 127,
    "windowStartMinute" INTEGER NOT NULL DEFAULT 0,
    "windowEndMinute" INTEGER NOT NULL DEFAULT 1440,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'OPEN',
    "offeredSlotJson" JSONB,
    "offerExpiresAt" TIMESTAMPTZ(3),
    "notifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Salon" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "defaultTimezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "brandJson" JSONB,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "websiteUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Salon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonSettings" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "slotGranularityMin" INTEGER NOT NULL DEFAULT 15,
    "minBookingLeadMin" INTEGER NOT NULL DEFAULT 120,
    "maxAdvanceDays" INTEGER NOT NULL DEFAULT 120,
    "defaultBufferBeforeMin" INTEGER NOT NULL DEFAULT 0,
    "defaultBufferAfterMin" INTEGER NOT NULL DEFAULT 10,
    "allowFinishAfterCloseMin" INTEGER NOT NULL DEFAULT 15,
    "holdTtlSeconds" INTEGER NOT NULL DEFAULT 900,
    "interleaveEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxConcurrentClients" INTEGER NOT NULL DEFAULT 2,
    "minInterleaveMin" INTEGER NOT NULL DEFAULT 25,
    "consultationSlaHours" INTEGER NOT NULL DEFAULT 24,
    "consultationExpiryDays" INTEGER NOT NULL DEFAULT 60,
    "planValidityDays" INTEGER NOT NULL DEFAULT 90,
    "autoApproveSimple" BOOLEAN NOT NULL DEFAULT false,
    "cancellationWindowHours" INTEGER NOT NULL DEFAULT 48,
    "cancellationFeePercent" INTEGER NOT NULL DEFAULT 50,
    "noShowFeePercent" INTEGER NOT NULL DEFAULT 100,
    "depositCapCents" INTEGER NOT NULL DEFAULT 50000,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiPhotoAnalysisEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SalonSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "isBookable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "code" "PlanCode" NOT NULL,
    "name" TEXT NOT NULL,
    "descriptionText" TEXT NOT NULL,
    "monthlyPriceCents" INTEGER NOT NULL,
    "yearlyPriceCents" INTEGER NOT NULL,
    "maxLocations" INTEGER NOT NULL,
    "maxStylists" INTEGER NOT NULL,
    "featuresJson" JSONB NOT NULL,
    "aiMonthlyCostCapMicros" BIGINT NOT NULL DEFAULT 0,
    "stripePriceIdMonthly" TEXT,
    "stripePriceIdYearly" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "planCode" "PlanCode" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "seats" INTEGER NOT NULL DEFAULT 1,
    "smsCreditsRemaining" INTEGER NOT NULL DEFAULT 500,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "currentPeriodEnd" TIMESTAMPTZ(3),
    "trialEndsAt" TIMESTAMPTZ(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMPTZ(3),
    "passwordHash" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "image" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "permissionOverridesJson" JSONB,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StylistProfile" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "title" TEXT,
    "bio" TEXT,
    "photoKey" TEXT,
    "colorHex" TEXT NOT NULL DEFAULT '#0F2A4A',
    "acceptsNewClients" BOOLEAN NOT NULL DEFAULT true,
    "isBoothRenter" BOOLEAN NOT NULL DEFAULT false,
    "commissionBps" INTEGER,
    "bookingLeadMin" INTEGER,
    "maxConcurrentClients" INTEGER,
    "maxDailyChemicalServices" INTEGER,
    "defaultLocationId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StylistProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StylistSkill" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "stylistProfileId" TEXT NOT NULL,
    "skillCode" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 3,

    CONSTRAINT "StylistSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientProfile" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "userId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "dateOfBirth" DATE,
    "pronouns" TEXT,
    "preferredStylistId" TEXT,
    "tags" TEXT[],
    "source" TEXT NOT NULL DEFAULT 'PORTAL',
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "mergedIntoId" TEXT,
    "internalNotes" TEXT,
    "noShowCount" INTEGER NOT NULL DEFAULT 0,
    "completedVisits" INTEGER NOT NULL DEFAULT 0,
    "lifetimeSpendCents" INTEGER NOT NULL DEFAULT 0,
    "firstVisitAt" TIMESTAMPTZ(3),
    "lastVisitAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClientProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceCategory_salonId_isActive_idx" ON "ServiceCategory"("salonId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_salonId_slug_key" ON "ServiceCategory"("salonId", "slug");

-- CreateIndex
CREATE INDEX "Service_salonId_categoryId_isActive_idx" ON "Service"("salonId", "categoryId", "isActive");

-- CreateIndex
CREATE INDEX "Service_salonId_isBookableOnline_idx" ON "Service"("salonId", "isBookableOnline");

-- CreateIndex
CREATE UNIQUE INDEX "Service_salonId_slug_key" ON "Service"("salonId", "slug");

-- CreateIndex
CREATE INDEX "ServicePhase_salonId_serviceId_idx" ON "ServicePhase"("salonId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePhase_serviceId_sequence_key" ON "ServicePhase"("serviceId", "sequence");

-- CreateIndex
CREATE INDEX "ServiceVariant_salonId_serviceId_idx" ON "ServiceVariant"("salonId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceVariant_serviceId_key_key" ON "ServiceVariant"("serviceId", "key");

-- CreateIndex
CREATE INDEX "StylistService_salonId_serviceId_isEnabled_idx" ON "StylistService"("salonId", "serviceId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "StylistService_stylistProfileId_serviceId_key" ON "StylistService"("stylistProfileId", "serviceId");

-- CreateIndex
CREATE INDEX "ServiceModifier_salonId_factorKey_factorValue_idx" ON "ServiceModifier"("salonId", "factorKey", "factorValue");

-- CreateIndex
CREATE INDEX "ServiceModifier_salonId_serviceId_idx" ON "ServiceModifier"("salonId", "serviceId");

-- CreateIndex
CREATE INDEX "DepositPolicy_salonId_isDefault_idx" ON "DepositPolicy"("salonId", "isDefault");

-- CreateIndex
CREATE INDEX "Deposit_salonId_status_idx" ON "Deposit"("salonId", "status");

-- CreateIndex
CREATE INDEX "Deposit_salonId_clientProfileId_idx" ON "Deposit"("salonId", "clientProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_appointmentId_key" ON "Invoice"("appointmentId");

-- CreateIndex
CREATE INDEX "Invoice_salonId_status_issuedAt_idx" ON "Invoice"("salonId", "status", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_salonId_number_key" ON "Invoice"("salonId", "number");

-- CreateIndex
CREATE INDEX "InvoiceLine_salonId_invoiceId_idx" ON "InvoiceLine"("salonId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_salonId_status_createdAt_idx" ON "Payment"("salonId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_salonId_clientProfileId_idx" ON "Payment"("salonId", "clientProfileId");

-- CreateIndex
CREATE INDEX "Refund_salonId_paymentId_idx" ON "Refund"("salonId", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationFee_appointmentId_key" ON "CancellationFee"("appointmentId");

-- CreateIndex
CREATE INDEX "CancellationFee_salonId_status_idx" ON "CancellationFee"("salonId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyAccount_clientProfileId_key" ON "LoyaltyAccount"("clientProfileId");

-- CreateIndex
CREATE INDEX "LoyaltyAccount_salonId_idx" ON "LoyaltyAccount"("salonId");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_salonId_accountId_createdAt_idx" ON "LoyaltyTransaction"("salonId", "accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientMembershipPlan_salonId_isActive_idx" ON "ClientMembershipPlan"("salonId", "isActive");

-- CreateIndex
CREATE INDEX "ClientMembership_salonId_status_idx" ON "ClientMembership"("salonId", "status");

-- CreateIndex
CREATE INDEX "PackageDefinition_salonId_isActive_idx" ON "PackageDefinition"("salonId", "isActive");

-- CreateIndex
CREATE INDEX "PackagePurchase_salonId_clientProfileId_idx" ON "PackagePurchase"("salonId", "clientProfileId");

-- CreateIndex
CREATE INDEX "PackageRedemption_salonId_packagePurchaseId_idx" ON "PackageRedemption"("salonId", "packagePurchaseId");

-- CreateIndex
CREATE INDEX "RetailProduct_salonId_isActive_idx" ON "RetailProduct"("salonId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RetailProduct_salonId_sku_key" ON "RetailProduct"("salonId", "sku");

-- CreateIndex
CREATE INDEX "RetailSale_salonId_soldAt_idx" ON "RetailSale"("salonId", "soldAt");

-- CreateIndex
CREATE INDEX "ProductUsage_salonId_appointmentId_idx" ON "ProductUsage"("salonId", "appointmentId");

-- CreateIndex
CREATE INDEX "ProductRecommendation_salonId_clientProfileId_status_idx" ON "ProductRecommendation"("salonId", "clientProfileId", "status");

-- CreateIndex
CREATE INDEX "MessageThread_salonId_status_lastMessageAt_idx" ON "MessageThread"("salonId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "MessageThread_salonId_clientProfileId_idx" ON "MessageThread"("salonId", "clientProfileId");

-- CreateIndex
CREATE INDEX "Message_salonId_threadId_createdAt_idx" ON "Message"("salonId", "threadId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_salonId_status_idx" ON "Message"("salonId", "status");

-- CreateIndex
CREATE INDEX "MessageTemplate_salonId_category_isActive_idx" ON "MessageTemplate"("salonId", "category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_salonId_key_version_key" ON "MessageTemplate"("salonId", "key", "version");

-- CreateIndex
CREATE INDEX "NotificationSchedule_salonId_trigger_isEnabled_idx" ON "NotificationSchedule"("salonId", "trigger", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSchedule_salonId_key_key" ON "NotificationSchedule"("salonId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledNotification_dedupeKey_key" ON "ScheduledNotification"("dedupeKey");

-- CreateIndex
CREATE INDEX "ScheduledNotification_salonId_status_sendAt_idx" ON "ScheduledNotification"("salonId", "status", "sendAt");

-- CreateIndex
CREATE INDEX "ContactConsent_salonId_channel_status_idx" ON "ContactConsent"("salonId", "channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContactConsent_clientProfileId_channel_purpose_key" ON "ContactConsent"("clientProfileId", "channel", "purpose");

-- CreateIndex
CREATE INDEX "SuppressionEntry_salonId_channel_idx" ON "SuppressionEntry"("salonId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEntry_channel_address_key" ON "SuppressionEntry"("channel", "address");

-- CreateIndex
CREATE INDEX "DevOutbox_createdAt_idx" ON "DevOutbox"("createdAt");

-- CreateIndex
CREATE INDEX "FormTemplate_salonId_kind_status_idx" ON "FormTemplate"("salonId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FormTemplate_salonId_key_version_key" ON "FormTemplate"("salonId", "key", "version");

-- CreateIndex
CREATE INDEX "FormSubmission_salonId_clientProfileId_submittedAt_idx" ON "FormSubmission"("salonId", "clientProfileId", "submittedAt");

-- CreateIndex
CREATE INDEX "FormSubmission_salonId_formTemplateId_idx" ON "FormSubmission"("salonId", "formTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "Signature_formSubmissionId_key" ON "Signature"("formSubmissionId");

-- CreateIndex
CREATE INDEX "Signature_salonId_signedAt_idx" ON "Signature"("salonId", "signedAt");

-- CreateIndex
CREATE INDEX "PatchTest_salonId_clientProfileId_validUntil_idx" ON "PatchTest"("salonId", "clientProfileId", "validUntil");

-- CreateIndex
CREATE INDEX "StrandTest_salonId_clientProfileId_performedAt_idx" ON "StrandTest"("salonId", "clientProfileId", "performedAt");

-- CreateIndex
CREATE INDEX "ConsentGrant_salonId_clientProfileId_kind_idx" ON "ConsentGrant"("salonId", "clientProfileId", "kind");

-- CreateIndex
CREATE INDEX "Policy_salonId_type_isActive_idx" ON "Policy"("salonId", "type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_salonId_type_version_key" ON "Policy"("salonId", "type", "version");

-- CreateIndex
CREATE INDEX "PolicyAcknowledgement_salonId_clientProfileId_idx" ON "PolicyAcknowledgement"("salonId", "clientProfileId");

-- CreateIndex
CREATE INDEX "ConsultationTemplate_salonId_status_idx" ON "ConsultationTemplate"("salonId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationTemplate_salonId_key_version_key" ON "ConsultationTemplate"("salonId", "key", "version");

-- CreateIndex
CREATE INDEX "ConsultationQuestion_templateId_sortOrder_idx" ON "ConsultationQuestion"("templateId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationQuestion_templateId_key_key" ON "ConsultationQuestion"("templateId", "key");

-- CreateIndex
CREATE INDEX "Consultation_salonId_status_slaDueAt_idx" ON "Consultation"("salonId", "status", "slaDueAt");

-- CreateIndex
CREATE INDEX "Consultation_salonId_clientProfileId_createdAt_idx" ON "Consultation"("salonId", "clientProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultationAnswer_salonId_consultationId_idx" ON "ConsultationAnswer"("salonId", "consultationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationAnswer_consultationId_questionKey_key" ON "ConsultationAnswer"("consultationId", "questionKey");

-- CreateIndex
CREATE INDEX "PhotoAsset_salonId_clientProfileId_idx" ON "PhotoAsset"("salonId", "clientProfileId");

-- CreateIndex
CREATE INDEX "PhotoAsset_salonId_createdAt_idx" ON "PhotoAsset"("salonId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultationPhoto_salonId_consultationId_idx" ON "ConsultationPhoto"("salonId", "consultationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationPhoto_consultationId_view_sequence_key" ON "ConsultationPhoto"("consultationId", "view", "sequence");

-- CreateIndex
CREATE INDEX "InspirationPhoto_salonId_consultationId_idx" ON "InspirationPhoto"("salonId", "consultationId");

-- CreateIndex
CREATE INDEX "InspirationAttribute_salonId_inspirationPhotoId_idx" ON "InspirationAttribute"("salonId", "inspirationPhotoId");

-- CreateIndex
CREATE INDEX "RuleEvaluation_salonId_consultationId_createdAt_idx" ON "RuleEvaluation"("salonId", "consultationId", "createdAt");

-- CreateIndex
CREATE INDEX "RuleEvaluation_rulesetVersion_idx" ON "RuleEvaluation"("rulesetVersion");

-- CreateIndex
CREATE INDEX "RiskFlag_salonId_consultationId_severity_idx" ON "RiskFlag"("salonId", "consultationId", "severity");

-- CreateIndex
CREATE INDEX "RiskFlag_salonId_ruleId_idx" ON "RiskFlag"("salonId", "ruleId");

-- CreateIndex
CREATE INDEX "ConsultationReview_salonId_consultationId_idx" ON "ConsultationReview"("salonId", "consultationId");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePlan_consultationId_key" ON "ServicePlan"("consultationId");

-- CreateIndex
CREATE INDEX "ServicePlan_salonId_status_idx" ON "ServicePlan"("salonId", "status");

-- CreateIndex
CREATE INDEX "ServicePlan_salonId_clientProfileId_idx" ON "ServicePlan"("salonId", "clientProfileId");

-- CreateIndex
CREATE INDEX "ServicePlanSession_salonId_servicePlanId_idx" ON "ServicePlanSession"("salonId", "servicePlanId");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePlanSession_servicePlanId_sequence_key" ON "ServicePlanSession"("servicePlanId", "sequence");

-- CreateIndex
CREATE INDEX "ServicePlanSessionService_salonId_sessionId_idx" ON "ServicePlanSessionService"("salonId", "sessionId");

-- CreateIndex
CREATE INDEX "PreRequirement_salonId_servicePlanId_status_idx" ON "PreRequirement"("salonId", "servicePlanId", "status");

-- CreateIndex
CREATE INDEX "PreRequirement_salonId_consultationId_status_idx" ON "PreRequirement"("salonId", "consultationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HairProfile_clientProfileId_key" ON "HairProfile"("clientProfileId");

-- CreateIndex
CREATE INDEX "HairProfile_salonId_idx" ON "HairProfile"("salonId");

-- CreateIndex
CREATE INDEX "HairHistoryEvent_salonId_clientProfileId_occurredAt_idx" ON "HairHistoryEvent"("salonId", "clientProfileId", "occurredAt");

-- CreateIndex
CREATE INDEX "HairHistoryEvent_salonId_type_idx" ON "HairHistoryEvent"("salonId", "type");

-- CreateIndex
CREATE INDEX "Formula_salonId_clientProfileId_createdAt_idx" ON "Formula"("salonId", "clientProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "Formula_salonId_stylistProfileId_idx" ON "Formula"("salonId", "stylistProfileId");

-- CreateIndex
CREATE INDEX "FormulaComponent_salonId_formulaId_idx" ON "FormulaComponent"("salonId", "formulaId");

-- CreateIndex
CREATE INDEX "HairConditionAssessment_salonId_clientProfileId_assessedAt_idx" ON "HairConditionAssessment"("salonId", "clientProfileId", "assessedAt");

-- CreateIndex
CREATE INDEX "AppointmentPhoto_salonId_appointmentId_kind_idx" ON "AppointmentPhoto"("salonId", "appointmentId", "kind");

-- CreateIndex
CREATE INDEX "AuditLog_salonId_createdAt_idx" ON "AuditLog"("salonId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_salonId_entityType_entityId_idx" ON "AuditLog"("salonId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_salonId_action_idx" ON "AuditLog"("salonId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteAccuracy_appointmentId_key" ON "QuoteAccuracy"("appointmentId");

-- CreateIndex
CREATE INDEX "QuoteAccuracy_salonId_stylistProfileId_computedAt_idx" ON "QuoteAccuracy"("salonId", "stylistProfileId", "computedAt");

-- CreateIndex
CREATE INDEX "QuoteAccuracy_salonId_computedAt_idx" ON "QuoteAccuracy"("salonId", "computedAt");

-- CreateIndex
CREATE INDEX "StylistCalibration_salonId_idx" ON "StylistCalibration"("salonId");

-- CreateIndex
CREATE UNIQUE INDEX "StylistCalibration_stylistProfileId_serviceId_key" ON "StylistCalibration"("stylistProfileId", "serviceId");

-- CreateIndex
CREATE INDEX "MetricSnapshot_salonId_metricKey_periodStart_idx" ON "MetricSnapshot"("salonId", "metricKey", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSnapshot_salonId_period_periodStart_metricKey_dimensi_key" ON "MetricSnapshot"("salonId", "period", "periodStart", "metricKey", "dimensionHash");

-- CreateIndex
CREATE INDEX "NoShowScore_salonId_appointmentId_idx" ON "NoShowScore"("salonId", "appointmentId");

-- CreateIndex
CREATE INDEX "NoShowScore_salonId_band_computedAt_idx" ON "NoShowScore"("salonId", "band", "computedAt");

-- CreateIndex
CREATE INDEX "AiSuggestion_salonId_kind_status_idx" ON "AiSuggestion"("salonId", "kind", "status");

-- CreateIndex
CREATE INDEX "AiSuggestion_salonId_refType_refId_idx" ON "AiSuggestion"("salonId", "refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageCounter_salonId_period_key" ON "AiUsageCounter"("salonId", "period");

-- CreateIndex
CREATE INDEX "Job_status_queue_priority_runAt_idx" ON "Job"("status", "queue", "priority", "runAt");

-- CreateIndex
CREATE INDEX "Job_status_lockedAt_idx" ON "Job"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "Job_salonId_type_createdAt_idx" ON "Job"("salonId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "RecurringSchedule_isEnabled_nextRunAt_idx" ON "RecurringSchedule"("isEnabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "Outbox_publishedAt_createdAt_idx" ON "Outbox"("publishedAt", "createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_scope_key_key" ON "IdempotencyKey"("scope", "key");

-- CreateIndex
CREATE INDEX "RulesetVersion_isDefault_idx" ON "RulesetVersion"("isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "SalonRulesetPin_salonId_key" ON "SalonRulesetPin"("salonId");

-- CreateIndex
CREATE INDEX "SalonRuleOverride_salonId_isEnabled_idx" ON "SalonRuleOverride"("salonId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "SalonRuleOverride_salonId_ruleId_key" ON "SalonRuleOverride"("salonId", "ruleId");

-- CreateIndex
CREATE INDEX "IntegrationConnection_salonId_isActive_idx" ON "IntegrationConnection"("salonId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_salonId_provider_stylistProfileId_key" ON "IntegrationConnection"("salonId", "provider", "stylistProfileId");

-- CreateIndex
CREATE INDEX "WorkingHours_salonId_stylistProfileId_dayOfWeek_idx" ON "WorkingHours"("salonId", "stylistProfileId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "WorkingHours_salonId_locationId_dayOfWeek_idx" ON "WorkingHours"("salonId", "locationId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "ScheduleException_salonId_date_idx" ON "ScheduleException"("salonId", "date");

-- CreateIndex
CREATE INDEX "TimeOff_salonId_stylistProfileId_startsAt_idx" ON "TimeOff"("salonId", "stylistProfileId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_servicePlanSessionId_key" ON "Appointment"("servicePlanSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_checkInToken_key" ON "Appointment"("checkInToken");

-- CreateIndex
CREATE INDEX "Appointment_salonId_startsAt_idx" ON "Appointment"("salonId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_salonId_primaryStylistId_startsAt_idx" ON "Appointment"("salonId", "primaryStylistId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_salonId_clientProfileId_startsAt_idx" ON "Appointment"("salonId", "clientProfileId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_salonId_status_startsAt_idx" ON "Appointment"("salonId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "AppointmentService_salonId_appointmentId_idx" ON "AppointmentService"("salonId", "appointmentId");

-- CreateIndex
CREATE INDEX "AppointmentSegment_salonId_startsAt_endsAt_idx" ON "AppointmentSegment"("salonId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "AppointmentSegment_salonId_stylistProfileId_startsAt_idx" ON "AppointmentSegment"("salonId", "stylistProfileId", "startsAt");

-- CreateIndex
CREATE INDEX "AppointmentSegment_salonId_resourceId_startsAt_idx" ON "AppointmentSegment"("salonId", "resourceId", "startsAt");

-- CreateIndex
CREATE INDEX "AppointmentSegment_state_holdExpiresAt_idx" ON "AppointmentSegment"("state", "holdExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingHold_idempotencyKey_key" ON "BookingHold"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BookingHold_salonId_status_expiresAt_idx" ON "BookingHold"("salonId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "BookingHold_salonId_primaryStylistId_startsAt_idx" ON "BookingHold"("salonId", "primaryStylistId", "startsAt");

-- CreateIndex
CREATE INDEX "WaitlistEntry_salonId_status_earliestDate_idx" ON "WaitlistEntry"("salonId", "status", "earliestDate");

-- CreateIndex
CREATE UNIQUE INDEX "Salon_slug_key" ON "Salon"("slug");

-- CreateIndex
CREATE INDEX "Salon_status_idx" ON "Salon"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SalonSettings_salonId_key" ON "SalonSettings"("salonId");

-- CreateIndex
CREATE INDEX "Location_salonId_isActive_idx" ON "Location"("salonId", "isActive");

-- CreateIndex
CREATE INDEX "Resource_salonId_locationId_type_idx" ON "Resource"("salonId", "locationId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_salonId_key" ON "Subscription"("salonId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Membership_salonId_role_status_idx" ON "Membership"("salonId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_salonId_userId_key" ON "Membership"("salonId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_salonId_email_idx" ON "Invitation"("salonId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "StylistProfile_membershipId_key" ON "StylistProfile"("membershipId");

-- CreateIndex
CREATE INDEX "StylistProfile_salonId_isActive_idx" ON "StylistProfile"("salonId", "isActive");

-- CreateIndex
CREATE INDEX "StylistSkill_salonId_skillCode_level_idx" ON "StylistSkill"("salonId", "skillCode", "level");

-- CreateIndex
CREATE UNIQUE INDEX "StylistSkill_stylistProfileId_skillCode_key" ON "StylistSkill"("stylistProfileId", "skillCode");

-- CreateIndex
CREATE INDEX "ClientProfile_salonId_status_idx" ON "ClientProfile"("salonId", "status");

-- CreateIndex
CREATE INDEX "ClientProfile_salonId_lastName_firstName_idx" ON "ClientProfile"("salonId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "ClientProfile_salonId_email_idx" ON "ClientProfile"("salonId", "email");

-- CreateIndex
CREATE INDEX "ClientProfile_salonId_phone_idx" ON "ClientProfile"("salonId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfile_salonId_userId_key" ON "ClientProfile"("salonId", "userId");

-- AddForeignKey
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_depositPolicyId_fkey" FOREIGN KEY ("depositPolicyId") REFERENCES "DepositPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePhase" ADD CONSTRAINT "ServicePhase_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVariant" ADD CONSTRAINT "ServiceVariant_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylistService" ADD CONSTRAINT "StylistService_stylistProfileId_fkey" FOREIGN KEY ("stylistProfileId") REFERENCES "StylistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylistService" ADD CONSTRAINT "StylistService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceModifier" ADD CONSTRAINT "ServiceModifier_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceModifier" ADD CONSTRAINT "ServiceModifier_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceModifier" ADD CONSTRAINT "ServiceModifier_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositPolicy" ADD CONSTRAINT "DepositPolicy_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationFee" ADD CONSTRAINT "CancellationFee_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMembershipPlan" ADD CONSTRAINT "ClientMembershipPlan_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMembership" ADD CONSTRAINT "ClientMembership_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMembership" ADD CONSTRAINT "ClientMembership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ClientMembershipPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageDefinition" ADD CONSTRAINT "PackageDefinition_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageDefinition" ADD CONSTRAINT "PackageDefinition_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagePurchase" ADD CONSTRAINT "PackagePurchase_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagePurchase" ADD CONSTRAINT "PackagePurchase_packageDefinitionId_fkey" FOREIGN KEY ("packageDefinitionId") REFERENCES "PackageDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageRedemption" ADD CONSTRAINT "PackageRedemption_packagePurchaseId_fkey" FOREIGN KEY ("packagePurchaseId") REFERENCES "PackagePurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageRedemption" ADD CONSTRAINT "PackageRedemption_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailProduct" ADD CONSTRAINT "RetailProduct_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailSale" ADD CONSTRAINT "RetailSale_productId_fkey" FOREIGN KEY ("productId") REFERENCES "RetailProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailSale" ADD CONSTRAINT "RetailSale_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUsage" ADD CONSTRAINT "ProductUsage_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUsage" ADD CONSTRAINT "ProductUsage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "RetailProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecommendation" ADD CONSTRAINT "ProductRecommendation_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecommendation" ADD CONSTRAINT "ProductRecommendation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecommendation" ADD CONSTRAINT "ProductRecommendation_retailProductId_fkey" FOREIGN KEY ("retailProductId") REFERENCES "RetailProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSchedule" ADD CONSTRAINT "NotificationSchedule_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSchedule" ADD CONSTRAINT "NotificationSchedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledNotification" ADD CONSTRAINT "ScheduledNotification_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "NotificationSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledNotification" ADD CONSTRAINT "ScheduledNotification_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactConsent" ADD CONSTRAINT "ContactConsent_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formTemplateId_fkey" FOREIGN KEY ("formTemplateId") REFERENCES "FormTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_formSubmissionId_fkey" FOREIGN KEY ("formSubmissionId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatchTest" ADD CONSTRAINT "PatchTest_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatchTest" ADD CONSTRAINT "PatchTest_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatchTest" ADD CONSTRAINT "PatchTest_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatchTest" ADD CONSTRAINT "PatchTest_servicePlanId_fkey" FOREIGN KEY ("servicePlanId") REFERENCES "ServicePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrandTest" ADD CONSTRAINT "StrandTest_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrandTest" ADD CONSTRAINT "StrandTest_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrandTest" ADD CONSTRAINT "StrandTest_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrandTest" ADD CONSTRAINT "StrandTest_servicePlanId_fkey" FOREIGN KEY ("servicePlanId") REFERENCES "ServicePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrandTest" ADD CONSTRAINT "StrandTest_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "Formula"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentGrant" ADD CONSTRAINT "ConsentGrant_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentGrant" ADD CONSTRAINT "ConsentGrant_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentGrant" ADD CONSTRAINT "ConsentGrant_evidenceFormSubmissionId_fkey" FOREIGN KEY ("evidenceFormSubmissionId") REFERENCES "FormSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAcknowledgement" ADD CONSTRAINT "PolicyAcknowledgement_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAcknowledgement" ADD CONSTRAINT "PolicyAcknowledgement_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationTemplate" ADD CONSTRAINT "ConsultationTemplate_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationQuestion" ADD CONSTRAINT "ConsultationQuestion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ConsultationTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ConsultationTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationAnswer" ADD CONSTRAINT "ConsultationAnswer_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationAnswer" ADD CONSTRAINT "ConsultationAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ConsultationQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoAsset" ADD CONSTRAINT "PhotoAsset_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoAsset" ADD CONSTRAINT "PhotoAsset_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationPhoto" ADD CONSTRAINT "ConsultationPhoto_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationPhoto" ADD CONSTRAINT "ConsultationPhoto_photoAssetId_fkey" FOREIGN KEY ("photoAssetId") REFERENCES "PhotoAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspirationPhoto" ADD CONSTRAINT "InspirationPhoto_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspirationPhoto" ADD CONSTRAINT "InspirationPhoto_photoAssetId_fkey" FOREIGN KEY ("photoAssetId") REFERENCES "PhotoAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspirationAttribute" ADD CONSTRAINT "InspirationAttribute_inspirationPhotoId_fkey" FOREIGN KEY ("inspirationPhotoId") REFERENCES "InspirationPhoto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleEvaluation" ADD CONSTRAINT "RuleEvaluation_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleEvaluation" ADD CONSTRAINT "RuleEvaluation_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskFlag" ADD CONSTRAINT "RiskFlag_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskFlag" ADD CONSTRAINT "RiskFlag_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "RuleEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationReview" ADD CONSTRAINT "ConsultationReview_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlan" ADD CONSTRAINT "ServicePlan_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlan" ADD CONSTRAINT "ServicePlan_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlan" ADD CONSTRAINT "ServicePlan_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlan" ADD CONSTRAINT "ServicePlan_stylistProfileId_fkey" FOREIGN KEY ("stylistProfileId") REFERENCES "StylistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlan" ADD CONSTRAINT "ServicePlan_depositPolicyId_fkey" FOREIGN KEY ("depositPolicyId") REFERENCES "DepositPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlan" ADD CONSTRAINT "ServicePlan_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "RuleEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlanSession" ADD CONSTRAINT "ServicePlanSession_servicePlanId_fkey" FOREIGN KEY ("servicePlanId") REFERENCES "ServicePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlanSessionService" ADD CONSTRAINT "ServicePlanSessionService_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ServicePlanSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlanSessionService" ADD CONSTRAINT "ServicePlanSessionService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlanSessionService" ADD CONSTRAINT "ServicePlanSessionService_serviceVariantId_fkey" FOREIGN KEY ("serviceVariantId") REFERENCES "ServiceVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreRequirement" ADD CONSTRAINT "PreRequirement_servicePlanId_fkey" FOREIGN KEY ("servicePlanId") REFERENCES "ServicePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreRequirement" ADD CONSTRAINT "PreRequirement_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HairProfile" ADD CONSTRAINT "HairProfile_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HairProfile" ADD CONSTRAINT "HairProfile_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HairHistoryEvent" ADD CONSTRAINT "HairHistoryEvent_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HairHistoryEvent" ADD CONSTRAINT "HairHistoryEvent_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HairHistoryEvent" ADD CONSTRAINT "HairHistoryEvent_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HairHistoryEvent" ADD CONSTRAINT "HairHistoryEvent_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HairHistoryEvent" ADD CONSTRAINT "HairHistoryEvent_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "Formula"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Formula" ADD CONSTRAINT "Formula_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Formula" ADD CONSTRAINT "Formula_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Formula" ADD CONSTRAINT "Formula_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Formula" ADD CONSTRAINT "Formula_stylistProfileId_fkey" FOREIGN KEY ("stylistProfileId") REFERENCES "StylistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormulaComponent" ADD CONSTRAINT "FormulaComponent_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "Formula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HairConditionAssessment" ADD CONSTRAINT "HairConditionAssessment_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HairConditionAssessment" ADD CONSTRAINT "HairConditionAssessment_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HairConditionAssessment" ADD CONSTRAINT "HairConditionAssessment_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HairConditionAssessment" ADD CONSTRAINT "HairConditionAssessment_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentPhoto" ADD CONSTRAINT "AppointmentPhoto_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentPhoto" ADD CONSTRAINT "AppointmentPhoto_photoAssetId_fkey" FOREIGN KEY ("photoAssetId") REFERENCES "PhotoAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteAccuracy" ADD CONSTRAINT "QuoteAccuracy_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteAccuracy" ADD CONSTRAINT "QuoteAccuracy_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteAccuracy" ADD CONSTRAINT "QuoteAccuracy_stylistProfileId_fkey" FOREIGN KEY ("stylistProfileId") REFERENCES "StylistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylistCalibration" ADD CONSTRAINT "StylistCalibration_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylistCalibration" ADD CONSTRAINT "StylistCalibration_stylistProfileId_fkey" FOREIGN KEY ("stylistProfileId") REFERENCES "StylistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylistCalibration" ADD CONSTRAINT "StylistCalibration_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoShowScore" ADD CONSTRAINT "NoShowScore_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoShowScore" ADD CONSTRAINT "NoShowScore_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageCounter" ADD CONSTRAINT "AiUsageCounter_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonRulesetPin" ADD CONSTRAINT "SalonRulesetPin_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonRulesetPin" ADD CONSTRAINT "SalonRulesetPin_rulesetVersion_fkey" FOREIGN KEY ("rulesetVersion") REFERENCES "RulesetVersion"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingHours" ADD CONSTRAINT "WorkingHours_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingHours" ADD CONSTRAINT "WorkingHours_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingHours" ADD CONSTRAINT "WorkingHours_stylistProfileId_fkey" FOREIGN KEY ("stylistProfileId") REFERENCES "StylistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_stylistProfileId_fkey" FOREIGN KEY ("stylistProfileId") REFERENCES "StylistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_stylistProfileId_fkey" FOREIGN KEY ("stylistProfileId") REFERENCES "StylistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_primaryStylistId_fkey" FOREIGN KEY ("primaryStylistId") REFERENCES "StylistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_servicePlanId_fkey" FOREIGN KEY ("servicePlanId") REFERENCES "ServicePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_servicePlanSessionId_fkey" FOREIGN KEY ("servicePlanSessionId") REFERENCES "ServicePlanSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_serviceVariantId_fkey" FOREIGN KEY ("serviceVariantId") REFERENCES "ServiceVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_stylistProfileId_fkey" FOREIGN KEY ("stylistProfileId") REFERENCES "StylistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSegment" ADD CONSTRAINT "AppointmentSegment_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSegment" ADD CONSTRAINT "AppointmentSegment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSegment" ADD CONSTRAINT "AppointmentSegment_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSegment" ADD CONSTRAINT "AppointmentSegment_appointmentServiceId_fkey" FOREIGN KEY ("appointmentServiceId") REFERENCES "AppointmentService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSegment" ADD CONSTRAINT "AppointmentSegment_bookingHoldId_fkey" FOREIGN KEY ("bookingHoldId") REFERENCES "BookingHold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSegment" ADD CONSTRAINT "AppointmentSegment_stylistProfileId_fkey" FOREIGN KEY ("stylistProfileId") REFERENCES "StylistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSegment" ADD CONSTRAINT "AppointmentSegment_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_primaryStylistId_fkey" FOREIGN KEY ("primaryStylistId") REFERENCES "StylistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonSettings" ADD CONSTRAINT "SalonSettings_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "Plan"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylistProfile" ADD CONSTRAINT "StylistProfile_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylistProfile" ADD CONSTRAINT "StylistProfile_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylistProfile" ADD CONSTRAINT "StylistProfile_defaultLocationId_fkey" FOREIGN KEY ("defaultLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylistSkill" ADD CONSTRAINT "StylistSkill_stylistProfileId_fkey" FOREIGN KEY ("stylistProfileId") REFERENCES "StylistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_preferredStylistId_fkey" FOREIGN KEY ("preferredStylistId") REFERENCES "StylistProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
