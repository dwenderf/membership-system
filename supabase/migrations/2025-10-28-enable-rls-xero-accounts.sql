-- Migration: Enable RLS on xero_accounts table
-- Date: 2025-10-28
-- Purpose: Add Row Level Security to xero_accounts table to fix Supabase linter warning
--
-- Background:
-- The xero_accounts table caches Xero chart of accounts and is currently only
-- accessed via API routes using the admin client. However, it's exposed via PostgREST
-- so we need RLS to prevent direct unauthorized access.
--
-- Access Pattern:
-- - Reads: Admin only (for autocomplete in admin forms)
-- - Writes: Admin only (sync operations)

-- Enable RLS on xero_accounts table
ALTER TABLE xero_accounts ENABLE ROW LEVEL SECURITY;

-- Policy: Only admins can access xero_accounts
-- This includes both reads (autocomplete) and writes (sync operations)
CREATE POLICY "Admin only access to xero accounts" ON xero_accounts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.is_admin = true
    )
  );

-- Add comment explaining the policy
COMMENT ON POLICY "Admin only access to xero accounts" ON xero_accounts IS
'Restricts all access to xero_accounts table to admin users only. This includes both read operations (autocomplete in admin forms) and write operations (sync processes).';
