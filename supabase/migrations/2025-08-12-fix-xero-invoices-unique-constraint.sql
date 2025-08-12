-- Fix xero_invoices unique constraint to allow both invoice and credit note per payment
-- This enables proper refund processing where one payment can have:
-- 1. Original invoice (ACCREC) 
-- 2. Refund credit note (ACCRECCREDIT)

-- Drop the existing constraint that only allows one invoice per payment+tenant
ALTER TABLE xero_invoices DROP CONSTRAINT IF EXISTS xero_invoices_payment_tenant_unique;

-- Add new constraint that allows one invoice per payment+tenant+type
-- This permits both an ACCREC invoice and ACCRECCREDIT credit note for the same payment
ALTER TABLE xero_invoices ADD CONSTRAINT xero_invoices_payment_tenant_type_unique 
UNIQUE (payment_id, tenant_id, invoice_type);