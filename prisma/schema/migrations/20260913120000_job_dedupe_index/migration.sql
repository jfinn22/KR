-- Recurring sweeps claim a time bucket with their dedupe key and now ask
-- whether that bucket has been done at all, not whether a copy is still in
-- flight. That lookup can no longer be served by the status indexes, and it
-- runs once per sweep on every scheduler tick, so it needs its own.
CREATE INDEX IF NOT EXISTS "Job_dedupeKey_idx" ON "Job"("dedupeKey");

-- `system.reap` deletes succeeded jobs older than the retention window. Without
-- this the prune scans the very table it exists to keep small.
CREATE INDEX IF NOT EXISTS "Job_status_completedAt_idx" ON "Job"("status", "completedAt");
