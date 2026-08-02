-- A client who asked to be erased is owed a definitive answer, and ARCHIVED
-- does not say that their identity was actually removed. Keeping it distinct
-- also stops an erased record being quietly reactivated by a client merge.
ALTER TYPE "ClientStatus" ADD VALUE IF NOT EXISTS 'ERASED';
