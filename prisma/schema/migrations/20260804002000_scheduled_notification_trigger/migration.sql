-- A scheduled notification did not record why it existed.
--
-- `scheduleId` is nullable, so a notification for a trigger a salon has not
-- configured a schedule for carries no trigger at all — and the sender, which
-- reads the trigger off the schedule, falls back to appointment wording. That
-- is fine for the one trigger that was ever materialised and wrong for the six
-- that are about to be.
ALTER TABLE "ScheduledNotification"
    ADD COLUMN IF NOT EXISTS "trigger" "NotificationTrigger";
