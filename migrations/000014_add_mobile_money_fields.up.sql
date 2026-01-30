-- Add DMarkPay tracking to transactions
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS dmark_transaction_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS provider_status_code VARCHAR(10),
ADD COLUMN IF NOT EXISTS provider_status_message TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_dmark_id ON transactions(dmark_transaction_id);

-- Add DMarkPay tracking to withdraw_requests
ALTER TABLE withdraw_requests
ADD COLUMN IF NOT EXISTS dmark_transaction_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS provider_status_code VARCHAR(10),
ADD COLUMN IF NOT EXISTS provider_status_message TEXT;

CREATE INDEX IF NOT EXISTS idx_withdraw_requests_dmark_id ON withdraw_requests(dmark_transaction_id);

-- Create payment webhooks audit table (payin only - withdrawals are immediate)
CREATE TABLE IF NOT EXISTS payment_webhooks (
    id SERIAL PRIMARY KEY,
    dmark_transaction_id VARCHAR(100) NOT NULL,
    sp_transaction_id VARCHAR(100),
    status VARCHAR(50),
    status_code VARCHAR(10),
    payload JSONB,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_dmark_id ON payment_webhooks(dmark_transaction_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_sp_id ON payment_webhooks(sp_transaction_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_processed ON payment_webhooks(processed);
