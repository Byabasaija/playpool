-- Add admin authentication tables

-- Create admin_accounts table
CREATE TABLE IF NOT EXISTS admin_accounts (
  phone TEXT PRIMARY KEY,
  display_name TEXT,
  token_hash TEXT NOT NULL,
  roles TEXT[],
  allowed_ips TEXT[],
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create admin_audit table
CREATE TABLE IF NOT EXISTS admin_audit (
  id SERIAL PRIMARY KEY,
  admin_phone TEXT,
  ip TEXT,
  route TEXT,
  action TEXT,
  details JSONB,
  success BOOLEAN,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create index on admin_audit for efficient querying
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_phone ON admin_audit(admin_phone);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit(created_at DESC);
