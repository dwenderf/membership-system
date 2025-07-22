-- Add payment_id foreign key columns to business tables
-- This migration is backward compatible - existing code continues to work

-- Add payment_id to user_memberships table
ALTER TABLE user_memberships 
ADD COLUMN payment_id UUID REFERENCES payments(id);

-- Add payment_id to user_registrations table  
ALTER TABLE user_registrations
ADD COLUMN payment_id UUID REFERENCES payments(id);

-- Create indexes for performance
CREATE INDEX idx_user_memberships_payment_id ON user_memberships(payment_id);
CREATE INDEX idx_user_registrations_payment_id ON user_registrations(payment_id);

-- Add comments for documentation
COMMENT ON COLUMN user_memberships.payment_id IS 'Links membership to payment record for refactor architecture';
COMMENT ON COLUMN user_registrations.payment_id IS 'Links registration to payment record for refactor architecture';