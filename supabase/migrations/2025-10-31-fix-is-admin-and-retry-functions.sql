-- Migration: Fix is_admin_user function and remove broken last_retry_at references
-- Date: 2025-10-31
-- Purpose: Fix two critical bugs in database functions
--
-- Issue 1: is_admin_user() checking wrong location
-- The function was checking auth.users.raw_user_meta_data->>'is_admin'
-- but the actual admin flag is stored in public.users.is_admin column.
-- This caused all admin policies to fail, blocking admins from viewing other users' data.
--
-- Issue 2: Functions reference non-existent last_retry_at column
-- The 2025-10-28-fix-function-search-paths.sql migration added checks for
-- xi.last_retry_at and xp.last_retry_at, but these columns were never created
-- and there's no code to update them. This broke Xero sync completely.

-- Fix 1: Update is_admin_user to check the correct column
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
        AND is_admin = true
    );
END;
$function$;

COMMENT ON FUNCTION is_admin_user() IS
'Checks if the current user has admin privileges by checking public.users.is_admin column. Fixed to check correct location.';

-- Fix 2: Remove broken last_retry_at reference from get_pending_xero_invoices_with_lock
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
  ORDER BY xi.staged_at ASC
  LIMIT limit_count
  FOR UPDATE SKIP LOCKED;
END;
$$;

COMMENT ON FUNCTION get_pending_xero_invoices_with_lock(INTEGER) IS
'Returns pending Xero invoices with row-level locking. Removed broken last_retry_at check.';

-- Fix 3: Remove broken last_retry_at reference from get_pending_xero_payments_with_lock
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
  ORDER BY xp.staged_at ASC
  LIMIT limit_count
  FOR UPDATE SKIP LOCKED;
END;
$$;

COMMENT ON FUNCTION get_pending_xero_payments_with_lock(INTEGER) IS
'Returns pending Xero payments with row-level locking. Removed broken last_retry_at check.';
