-- Add audit timestamps to user_registrations table
-- Adds updated_at (auto-updated) and refunded_at (set when refunded)

-- Add updated_at column with default
ALTER TABLE user_registrations
ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add refunded_at column (NULL until refunded)
ALTER TABLE user_registrations
ADD COLUMN refunded_at TIMESTAMP WITH TIME ZONE;

-- Create trigger to auto-update updated_at on any change
-- (uses existing update_updated_at_column() function from Xero integration)
CREATE TRIGGER update_user_registrations_updated_at
    BEFORE UPDATE ON user_registrations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add index for querying recently refunded registrations
CREATE INDEX idx_user_registrations_refunded_at ON user_registrations(refunded_at) WHERE refunded_at IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN user_registrations.updated_at IS 'Timestamp of last update to this record (auto-updated by trigger)';
COMMENT ON COLUMN user_registrations.refunded_at IS 'Timestamp when this registration was refunded (NULL if not refunded)';
