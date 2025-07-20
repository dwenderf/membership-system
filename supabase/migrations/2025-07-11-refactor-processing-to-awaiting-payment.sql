-- Refactor 'processing' status to 'awaiting_payment' for better clarity
-- Also rename processing_expires_at to reservation_expires_at

-- Step 1: Add new column
ALTER TABLE user_registrations 
ADD COLUMN reservation_expires_at timestamptz;

-- Step 2: Copy data from old column to new column
UPDATE user_registrations 
SET reservation_expires_at = processing_expires_at 
WHERE processing_expires_at IS NOT NULL;

-- Step 3: Update payment_status values from 'processing' to 'awaiting_payment'
UPDATE user_registrations 
SET payment_status = 'awaiting_payment' 
WHERE payment_status = 'processing';

-- Step 4: Drop old column (commented out for safety - run manually after verification)
-- ALTER TABLE user_registrations DROP COLUMN processing_expires_at;

-- Add comment for clarity
COMMENT ON COLUMN user_registrations.reservation_expires_at IS 'When the spot reservation expires (user must complete payment before this time)';