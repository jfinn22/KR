-- Three AiKind values nothing could ever produce.
--
-- MESSAGE_DRAFT belonged to `draftMessage`, which took a MessageThread id — and
-- MessageThread was dropped with the unused models. PLAN_NARRATIVE and
-- SEGMENTATION never had a producing function at all: the prompt and the mock
-- response existed, and no code path could reach either.
--
-- Postgres cannot drop a value from an enum in place, so the type is rebuilt.
-- Safe because nothing has ever written one: the AiSuggestion table has no rows
-- carrying these kinds, which the rewrite would fail on if it did.

ALTER TYPE "AiKind" RENAME TO "AiKind_old";

CREATE TYPE "AiKind" AS ENUM (
  'CONSULTATION_SUMMARY',
  'PHOTO_ANALYSIS',
  'INSPIRATION_ATTRIBUTES',
  'RISK_EXPLAIN',
  'FORMULA_SUGGEST',
  'INTAKE_NORMALIZE'
);

ALTER TABLE "AiSuggestion"
  ALTER COLUMN "kind" TYPE "AiKind" USING ("kind"::text::"AiKind");

DROP TYPE "AiKind_old";
