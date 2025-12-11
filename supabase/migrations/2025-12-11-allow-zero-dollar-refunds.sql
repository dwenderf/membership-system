-- Allow zero-dollar refunds for free registration cancellations
-- This updates the constraint to allow amount >= 0 instead of amount > 0

-- Drop the old constraint
ALTER TABLE refunds DROP CONSTRAINT IF EXISTS chk_refund_amount_positive;

-- Add new constraint allowing zero amounts
ALTER TABLE refunds ADD CONSTRAINT chk_refund_amount_not_negative CHECK (amount >= 0);

-- Add comment explaining the change
COMMENT ON CONSTRAINT chk_refund_amount_not_negative ON refunds IS
'Refund amount must be non-negative. Zero-dollar refunds are allowed for canceling free registrations (e.g., 100% discounted registrations).';
