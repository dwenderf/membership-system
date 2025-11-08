-- Fix payments incorrectly marked as 'failed' that should be 'planned'
-- This corrects an issue where the payment plan migration's validation block
-- was setting 'planned' payments to 'failed' before adding 'planned' to the allowed statuses

-- Reset any installment payments (#2-4) that are marked as 'failed' with no sync_error
-- back to 'planned' status (their correct state for future payments)
UPDATE xero_payments
SET
  sync_status = 'planned',
  sync_error = NULL,
  last_synced_at = NULL
WHERE
  payment_type = 'installment'
  AND installment_number > 1
  AND sync_status = 'failed'
  AND (sync_error IS NULL OR sync_error = '');

-- Log what we fixed
DO $$
DECLARE
  fixed_count INTEGER;
BEGIN
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  IF fixed_count > 0 THEN
    RAISE NOTICE 'Fixed % payment plan installments incorrectly marked as failed', fixed_count;
  ELSE
    RAISE NOTICE 'No payment plan installments needed fixing';
  END IF;
END $$;
