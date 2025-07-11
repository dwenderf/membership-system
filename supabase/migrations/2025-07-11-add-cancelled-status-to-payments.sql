-- Add 'cancelled' status to payments table status constraint
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('pending', 'completed', 'failed', 'refunded', 'cancelled'));