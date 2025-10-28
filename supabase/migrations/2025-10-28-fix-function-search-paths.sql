-- Migration: Fix Function Search Path Mutable Warnings
-- Date: 2025-10-28
-- Purpose: Add explicit search_path to all functions to fix Supabase linter warnings
--
-- Background:
-- Functions without an explicit search_path are vulnerable to search_path injection attacks.
-- Setting search_path = public, pg_temp ensures functions only look in the public schema
-- and temporary schema, preventing malicious schema manipulation.

-- Fix 1: generate_member_id function
CREATE OR REPLACE FUNCTION generate_member_id()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN nextval('member_id_seq');
END;
$$;

-- Fix 2: set_member_id_on_insert trigger function
CREATE OR REPLACE FUNCTION set_member_id_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.member_id IS NULL THEN
        NEW.member_id := generate_member_id();
    END IF;
    RETURN NEW;
END;
$$;

-- Fix 3: update_updated_at_column trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Fix 4: notify_payment_completion trigger function
CREATE OR REPLACE FUNCTION notify_payment_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Emit PostgreSQL notification for async processing
    PERFORM pg_notify(
        'payment_completed',
        json_build_object(
            'event_type', TG_TABLE_NAME,
            'record_id', NEW.id,
            'user_id', NEW.user_id,
            'payment_id', CASE
                WHEN TG_TABLE_NAME = 'payments' THEN NEW.id
                ELSE NEW.payment_id
            END,
            'amount', CASE
                WHEN TG_TABLE_NAME = 'payments' THEN NEW.final_amount
                WHEN TG_TABLE_NAME = 'user_memberships' THEN COALESCE(NEW.amount_paid, 0)
                WHEN TG_TABLE_NAME = 'user_registrations' THEN COALESCE(NEW.amount_paid, 0)
                ELSE 0
            END,
            'trigger_source', TG_TABLE_NAME,
            'timestamp', NOW()
        )::text
    );
    RETURN NEW;
END;
$$;

-- Fix 5: get_pending_xero_invoices_with_lock function
-- Note: Using the latest version from the most recent migration
CREATE OR REPLACE FUNCTION get_pending_xero_invoices_with_lock(limit_count INTEGER DEFAULT 50)
RETURNS TABLE (
  id UUID,
  payment_id UUID,
  tenant_id TEXT,
  xero_invoice_id UUID,
  invoice_number TEXT,
  invoice_type TEXT,
  invoice_status TEXT,
  total_amount INTEGER,
  discount_amount INTEGER,
  net_amount INTEGER,
  stripe_fee_amount INTEGER,
  sync_status TEXT,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  sync_error TEXT,
  staged_at TIMESTAMP WITH TIME ZONE,
  staging_metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  line_items JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    xi.id,
    xi.payment_id,
    xi.tenant_id,
    xi.xero_invoice_id,
    xi.invoice_number,
    xi.invoice_type,
    xi.invoice_status,
    xi.total_amount,
    xi.discount_amount,
    xi.net_amount,
    xi.stripe_fee_amount,
    xi.sync_status,
    xi.last_synced_at,
    xi.sync_error,
    xi.staged_at,
    xi.staging_metadata,
    xi.created_at,
    xi.updated_at,
    (
      SELECT json_agg(json_build_object(
        'id', li.id,
        'line_item_type', li.line_item_type,
        'item_id', li.item_id,
        'description', li.description,
        'quantity', li.quantity,
        'unit_amount', li.unit_amount,
        'account_code', li.account_code,
        'tax_type', li.tax_type,
        'line_amount', li.line_amount
      ))
      FROM xero_invoice_line_items li
      WHERE li.xero_invoice_id = xi.id
    ) as line_items
  FROM xero_invoices xi
  WHERE xi.sync_status = 'pending'
    AND (xi.last_retry_at IS NULL OR xi.last_retry_at < NOW() - INTERVAL '5 minutes')
  ORDER BY xi.staged_at ASC
  LIMIT limit_count
  FOR UPDATE SKIP LOCKED;
END;
$$;

-- Fix 6: get_pending_xero_payments_with_lock function
CREATE OR REPLACE FUNCTION get_pending_xero_payments_with_lock(limit_count INTEGER DEFAULT 50)
RETURNS TABLE (
  id UUID,
  xero_invoice_id UUID,
  tenant_id TEXT,
  xero_payment_id UUID,
  payment_method TEXT,
  bank_account_code TEXT,
  amount_paid INTEGER,
  stripe_fee_amount INTEGER,
  reference TEXT,
  sync_status TEXT,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  sync_error TEXT,
  staged_at TIMESTAMP WITH TIME ZONE,
  staging_metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    xp.id,
    xp.xero_invoice_id,
    xp.tenant_id,
    xp.xero_payment_id,
    xp.payment_method,
    xp.bank_account_code,
    xp.amount_paid,
    xp.stripe_fee_amount,
    xp.reference,
    xp.sync_status,
    xp.last_synced_at,
    xp.sync_error,
    xp.staged_at,
    xp.staging_metadata,
    xp.created_at,
    xp.updated_at
  FROM xero_payments xp
  WHERE xp.sync_status = 'pending'
    AND (xp.last_retry_at IS NULL OR xp.last_retry_at < NOW() - INTERVAL '5 minutes')
  ORDER BY xp.staged_at ASC
  LIMIT limit_count
  FOR UPDATE SKIP LOCKED;
END;
$$;

-- Comments explaining the changes
COMMENT ON FUNCTION generate_member_id() IS
'Generates sequential member IDs starting from 1000. Fixed search_path for security.';

COMMENT ON FUNCTION set_member_id_on_insert() IS
'Trigger function to auto-generate member_id on user insert. Fixed search_path for security.';

COMMENT ON FUNCTION update_updated_at_column() IS
'Generic trigger function to update updated_at timestamp. Fixed search_path for security.';

COMMENT ON FUNCTION notify_payment_completion() IS
'Trigger function to emit payment completion notifications for async processing. Fixed search_path for security.';

COMMENT ON FUNCTION get_pending_xero_invoices_with_lock(INTEGER) IS
'Returns pending Xero invoices with row-level locking for concurrent processing. Fixed search_path for security.';

COMMENT ON FUNCTION get_pending_xero_payments_with_lock(INTEGER) IS
'Returns pending Xero payments with row-level locking for concurrent processing. Fixed search_path for security.';
