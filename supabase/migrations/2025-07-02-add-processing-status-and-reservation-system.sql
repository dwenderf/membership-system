-- Add processing status and reservation system for race condition protection

-- Update payment_status check constraint to include 'processing'
ALTER TABLE user_registrations 
DROP CONSTRAINT user_registrations_payment_status_check;

ALTER TABLE user_registrations 
ADD CONSTRAINT user_registrations_payment_status_check 
CHECK (payment_status IN ('pending', 'paid', 'refunded', 'processing'));

-- Add processing expiration timestamp for reservation system
ALTER TABLE user_registrations 
ADD COLUMN processing_expires_at TIMESTAMP WITH TIME ZONE;

-- Add index for efficient cleanup of expired processing reservations
CREATE INDEX idx_user_registrations_processing_expires 
ON user_registrations(processing_expires_at) 
WHERE payment_status = 'processing';

-- Add comment explaining the reservation system
COMMENT ON COLUMN user_registrations.processing_expires_at IS 
'Expiration time for processing reservations. Used to prevent race conditions by reserving spots for 5 minutes while payment is processed.';

-- Update schema comment to reflect new payment flow
COMMENT ON TABLE user_registrations IS 
'User registration records with reservation system. Flow: processing (reserved) -> paid (confirmed) or deleted (expired/failed).';