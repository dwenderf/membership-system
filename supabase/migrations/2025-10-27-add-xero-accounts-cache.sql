-- Migration: Add Xero Accounts Cache Table
-- Date: 2025-10-27
-- Purpose: Create table to cache Xero chart of accounts for validation and autocomplete

-- Create xero_accounts table to cache Xero chart of accounts
CREATE TABLE IF NOT EXISTS xero_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id TEXT NOT NULL REFERENCES xero_oauth_tokens(tenant_id) ON DELETE CASCADE,
  xero_account_id UUID NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  description TEXT,
  last_synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Ensure unique account per tenant
  CONSTRAINT unique_xero_account_per_tenant UNIQUE (tenant_id, xero_account_id)
);

-- Create indexes for efficient lookups
CREATE INDEX idx_xero_accounts_tenant_id ON xero_accounts(tenant_id);
CREATE INDEX idx_xero_accounts_code ON xero_accounts(code);
CREATE INDEX idx_xero_accounts_status ON xero_accounts(status);
CREATE INDEX idx_xero_accounts_type ON xero_accounts(type);
CREATE INDEX idx_xero_accounts_name ON xero_accounts(name);

-- Add comments for documentation
COMMENT ON TABLE xero_accounts IS 'Cached Xero chart of accounts for validation and autocomplete';
COMMENT ON COLUMN xero_accounts.tenant_id IS 'Xero tenant (organization) identifier';
COMMENT ON COLUMN xero_accounts.xero_account_id IS 'Xero UUID for the account';
COMMENT ON COLUMN xero_accounts.code IS 'Account code (e.g., "200", "SALES")';
COMMENT ON COLUMN xero_accounts.name IS 'Account name (max 150 chars)';
COMMENT ON COLUMN xero_accounts.type IS 'Account type: REVENUE, EXPENSE, ASSET, LIABILITY, EQUITY';
COMMENT ON COLUMN xero_accounts.status IS 'Account status: ACTIVE or ARCHIVED';
COMMENT ON COLUMN xero_accounts.description IS 'Optional account description (max 4000 chars)';
COMMENT ON COLUMN xero_accounts.last_synced_at IS 'When this record was last updated from Xero API';
