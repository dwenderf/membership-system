-- Add member ID system for unique identification
-- This will be used in Xero contact names to ensure uniqueness

-- Create sequence for member IDs starting from 1000
CREATE SEQUENCE IF NOT EXISTS member_id_seq START 1000;

-- Add member_id column to users table
ALTER TABLE users ADD COLUMN member_id INTEGER UNIQUE;

-- Create function to generate member ID
CREATE OR REPLACE FUNCTION generate_member_id() RETURNS INTEGER AS $$
BEGIN
    RETURN nextval('member_id_seq');
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate member_id on insert
CREATE OR REPLACE FUNCTION set_member_id_on_insert() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.member_id IS NULL THEN
        NEW.member_id := generate_member_id();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for users table
DROP TRIGGER IF EXISTS set_member_id_trigger ON users;
CREATE TRIGGER set_member_id_trigger
    BEFORE INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_member_id_on_insert();

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_users_member_id ON users(member_id);

-- Add comment for documentation
COMMENT ON COLUMN users.member_id IS 'Auto-generated unique member ID starting from 1000. Used for Xero contact identification.';