-- Allow zero-dollar refunds for free registration cancellations
-- This updates the constraint to allow amount >= 0 instead of amount > 0

-- Drop the old constraint (actual name in database is refunds_amount_check)
ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_amount_check;
ALTER TABLE refunds DROP CONSTRAINT IF EXISTS chk_refund_amount_positive;

-- Add new constraint allowing zero amounts
ALTER TABLE refunds ADD CONSTRAINT refunds_amount_check CHECK (amount >= 0);

-- Add comment explaining the change
COMMENT ON CONSTRAINT refunds_amount_check ON refunds IS
'Refund amount must be non-negative (in cents). Zero-dollar refunds are allowed for canceling free registrations (e.g., 100% discounted registrations).';
