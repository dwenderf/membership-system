-- Add updated_at and updated_by fields to registrations table
-- These fields are needed for tracking when and by whom registration settings are modified

ALTER TABLE registrations 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);

-- Add trigger to automatically update the updated_at field
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for registrations table
CREATE TRIGGER update_registrations_updated_at 
    BEFORE UPDATE ON registrations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update existing records to have the current timestamp
UPDATE registrations SET updated_at = created_at WHERE updated_at IS NULL;

-- Add index for updated_by field for performance
CREATE INDEX IF NOT EXISTS idx_registrations_updated_by ON registrations(updated_by);

-- Add comments for documentation
COMMENT ON COLUMN registrations.updated_at IS 'When the registration was last updated';
COMMENT ON COLUMN registrations.updated_by IS 'ID of the user who last updated the registration';