-- Migration: Drop duplicate indexes
-- Date: 2025-10-28
-- Purpose: Remove duplicate indexes identified by Supabase performance advisor
--
-- Background:
-- The Supabase linter identified 3 duplicate indexes that are redundant:
-- 1. idx_reports_data_discount_code_id is a duplicate of idx_xero_invoice_line_items_discount_code_id
-- 2. idx_reports_data_line_item_type is a duplicate of idx_xero_invoice_line_items_item_type
-- 3. idx_reports_data_sync_status is a duplicate of idx_xero_invoices_sync_status
--
-- Impact:
-- - Reduces storage overhead
-- - Reduces index maintenance cost during INSERT/UPDATE/DELETE operations
-- - No functional impact (the original indexes remain)

-- Drop duplicate index on xero_invoice_line_items.discount_code_id
DROP INDEX IF EXISTS idx_reports_data_discount_code_id;

-- Drop duplicate index on xero_invoice_line_items.item_type
DROP INDEX IF EXISTS idx_reports_data_line_item_type;

-- Drop duplicate index on xero_invoices.sync_status
DROP INDEX IF EXISTS idx_reports_data_sync_status;

-- Verify the original indexes still exist (this will error if they don't, which is good - it means we need to investigate)
-- These are just comments for documentation - the indexes should already exist
-- idx_xero_invoice_line_items_discount_code_id on xero_invoice_line_items(discount_code_id)
-- idx_xero_invoice_line_items_item_type on xero_invoice_line_items(item_type)
-- idx_xero_invoices_sync_status on xero_invoices(sync_status)
