-- Remove tax system account and enum value (best-effort)
DELETE FROM accounts WHERE account_type='tax';
-- Note: removing a value from an enum is non-trivial in Postgres; keep it if in use.
-- This down migration intentionally does not drop enum value to avoid data issues.
