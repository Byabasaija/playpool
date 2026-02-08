-- Rollback admin username and runtime_config

DROP TABLE IF EXISTS runtime_config;

DROP INDEX IF EXISTS idx_admin_audit_admin_username;
ALTER TABLE admin_audit DROP COLUMN IF EXISTS admin_username;

ALTER TABLE admin_accounts DROP COLUMN IF EXISTS password_hash;
ALTER TABLE admin_accounts DROP COLUMN IF EXISTS username;
