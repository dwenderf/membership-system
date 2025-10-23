-- Cleanup script: Mark old staged records as abandoned
-- This marks all staging records that are:
-- 1. Currently in 'staged' status
-- 2. More than 10 minutes old
-- 3. Not linked to a payment (payment_id is null)
-- as 'abandoned' since they represent incomplete/cancelled purchases

-- Mark old staged invoices as abandoned
UPDATE xero_invoices
SET
  sync_status = 'abandoned',
  sync_error = 'Automatically marked as abandoned - record older than 10 minutes without payment completion',
  updated_at = NOW()
WHERE
  sync_status = 'staged'
  AND payment_id IS NULL
  AND staged_at < NOW() - INTERVAL '10 minutes';

-- Mark corresponding payment records as abandoned
UPDATE xero_payments
SET
  sync_status = 'abandoned',
  sync_error = 'Automatically marked as abandoned - record older than 10 minutes without payment completion',
  updated_at = NOW()
WHERE
  sync_status = 'staged'
  AND xero_invoice_id IN (
    SELECT id
    FROM xero_invoices
    WHERE sync_status = 'abandoned'
  );

-- Report how many records were updated
DO $$
DECLARE
  invoice_count INTEGER;
  payment_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invoice_count
  FROM xero_invoices
  WHERE sync_status = 'abandoned';

  SELECT COUNT(*) INTO payment_count
  FROM xero_payments
  WHERE sync_status = 'abandoned';

  RAISE NOTICE 'Cleanup complete: % invoices and % payments marked as abandoned', invoice_count, payment_count;
END $$;
