-- ALKHAYR B2B — migration 0002: merchant access version (stage 05).
-- IMMUTABLE once applied. Runs inside the runner's single transaction.
--
-- access_version is a monotonic authorization marker. It increases by exactly
-- one on EVERY status change (pending/approved/suspended) and never changes
-- otherwise. Login records it before the (slow) password verification and
-- requires it unchanged at commit, so an approved -> suspended -> approved
-- sequence during an in-flight login (ABA) is detected even though the final
-- status string is the same. Profile edits do not touch it.

ALTER TABLE merchants ADD COLUMN access_version INTEGER NOT NULL DEFAULT 1 CHECK (access_version >= 1);

CREATE TRIGGER merchants_access_version_on_status_change BEFORE UPDATE OF status ON merchants
WHEN NEW.status IS NOT OLD.status AND NEW.access_version IS NOT OLD.access_version + 1
BEGIN SELECT RAISE(ABORT, 'merchants.access_version must increase by exactly 1 when status changes'); END;

CREATE TRIGGER merchants_access_version_only_with_status BEFORE UPDATE OF access_version ON merchants
WHEN NEW.status IS OLD.status AND NEW.access_version IS NOT OLD.access_version
BEGIN SELECT RAISE(ABORT, 'merchants.access_version changes only together with status'); END;
