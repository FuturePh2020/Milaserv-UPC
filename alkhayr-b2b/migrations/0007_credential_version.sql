-- ALKHAYR B2B — migration 0007: monotonic credential version (stage 15).
-- IMMUTABLE once applied. Runs inside the runner's single transaction.
--
-- Advanced by every operator recovery action (password reset, authenticator replacement, session
-- revocation). A login verifies password/TOTP outside its write transaction; at commit it requires
-- the version it read to be unchanged, so a login that started with old credentials or old MFA
-- material can never complete after a recovery, even if the final values happen to look the same.
ALTER TABLE auth_users ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version >= 1);

CREATE TRIGGER auth_users_credential_version_monotonic BEFORE UPDATE OF credential_version ON auth_users
WHEN NEW.credential_version < OLD.credential_version
BEGIN SELECT RAISE(ABORT, 'auth_users.credential_version can only increase'); END;

-- A new authenticator enrollment (changed totp_ciphertext) must advance the credential version.
CREATE TRIGGER auth_users_totp_change_bumps_version BEFORE UPDATE OF totp_ciphertext ON auth_users
WHEN NEW.totp_ciphertext IS NOT OLD.totp_ciphertext AND NEW.credential_version <= OLD.credential_version
BEGIN SELECT RAISE(ABORT, 'changing the TOTP enrollment requires a new credential_version'); END;
