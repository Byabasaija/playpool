-- Drop indexes
DROP INDEX IF EXISTS idx_webhooks_processed;
DROP INDEX IF EXISTS idx_webhooks_sp_id;
DROP INDEX IF EXISTS idx_webhooks_dmark_id;

-- Drop payment_webhooks table
DROP TABLE IF EXISTS payment_webhooks;

-- Remove DMarkPay fields from withdraw_requests
ALTER TABLE withdraw_requests
DROP COLUMN IF EXISTS provider_status_message,
DROP COLUMN IF EXISTS provider_status_code,
DROP COLUMN IF EXISTS dmark_transaction_id;

DROP INDEX IF EXISTS idx_withdraw_requests_dmark_id;

-- Remove DMarkPay fields from transactions
ALTER TABLE transactions
DROP COLUMN IF EXISTS provider_status_message,
DROP COLUMN IF EXISTS provider_status_code,
DROP COLUMN IF EXISTS dmark_transaction_id;

DROP INDEX IF EXISTS idx_transactions_dmark_id;
