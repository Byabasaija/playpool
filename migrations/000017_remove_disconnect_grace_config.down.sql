INSERT INTO runtime_config (key, value, value_type, description) VALUES
    ('disconnect_grace_period_secs', '120', 'int', 'Disconnect grace period in seconds')
ON CONFLICT (key) DO NOTHING;
