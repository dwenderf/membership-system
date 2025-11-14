-- Add DEFAULT value to payment_type column
-- This provides a safety net to prevent constraint violations if code forgets to set payment_type
-- Since 'installment' is only used for payment plans and explicitly set, 'full' is the correct default

ALTER TABLE xero_payments
ALTER COLUMN payment_type SET DEFAULT 'full';

COMMENT ON COLUMN xero_payments.payment_type IS 'Type of payment: full (single payment, DEFAULT) or installment (part of payment plan). Defaults to full for safety.';
