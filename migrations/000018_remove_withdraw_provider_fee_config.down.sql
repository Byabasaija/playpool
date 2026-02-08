INSERT INTO runtime_config (key, value, value_type, description) VALUES
    ('withdraw_provider_fee_percent', '3', 'int', 'Provider fee percentage for withdrawals')
ON CONFLICT (key) DO NOTHING;
