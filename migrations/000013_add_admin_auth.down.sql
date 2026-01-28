-- Rollback admin authentication tables

DROP INDEX IF EXISTS idx_admin_audit_created_at;
DROP INDEX IF EXISTS idx_admin_audit_admin_phone;
DROP TABLE IF EXISTS admin_audit;
DROP TABLE IF EXISTS admin_accounts;
