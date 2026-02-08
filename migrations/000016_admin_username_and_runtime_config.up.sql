-- Add username/password auth to admin_accounts and create runtime_config table

-- Add username and password_hash columns to admin_accounts
ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS username VARCHAR(100) UNIQUE;
ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Add admin_username column to admin_audit (alongside existing admin_phone)
ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS admin_username TEXT;
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_username ON admin_audit(admin_username);

-- Create runtime_config table for admin-editable game settings
CREATE TABLE IF NOT EXISTS runtime_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    value_type TEXT NOT NULL DEFAULT 'int',
    description TEXT,
    updated_by TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed with actively-used config values
INSERT INTO runtime_config (key, value, value_type, description) VALUES
    ('commission_flat', '1000', 'int', 'Flat commission amount in UGX'),
    ('min_stake_amount', '1000', 'int', 'Minimum stake amount in UGX'),
    ('payout_tax_percent', '15', 'int', 'Tax percentage on payouts'),
    ('game_expiry_minutes', '3', 'int', 'Game expiry time in minutes'),
    ('queue_expiry_minutes', '3', 'int', 'Queue expiry time in minutes'),
    ('disconnect_grace_period_secs', '120', 'int', 'Disconnect grace period in seconds'),
    ('idle_warning_seconds', '45', 'int', 'Idle warning time in seconds'),
    ('idle_forfeit_seconds', '90', 'int', 'Idle forfeit time in seconds'),
    ('min_withdraw_amount', '1000', 'int', 'Minimum withdrawal amount in UGX'),
    ('withdraw_provider_fee_percent', '3', 'int', 'Withdrawal provider fee percentage')
ON CONFLICT (key) DO NOTHING;
