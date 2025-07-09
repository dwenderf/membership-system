-- Create system_accounting_codes table for system-wide accounting codes
CREATE TABLE system_accounting_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_type TEXT NOT NULL,
    accounting_code TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT unique_code_type UNIQUE(code_type)
);

-- Insert default values
INSERT INTO system_accounting_codes (code_type, accounting_code, description) VALUES
('donation_default', 'DONATION', 'Default accounting code for donation line items in invoices'),
('registration_default', '', 'Default accounting code for registration categories without specific codes');

-- Add RLS policies
ALTER TABLE system_accounting_codes ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Allow authenticated users to read system accounting codes" 
ON system_accounting_codes FOR SELECT 
TO authenticated 
USING (true);

-- Allow admins to update
CREATE POLICY "Allow admins to update system accounting codes" 
ON system_accounting_codes FOR UPDATE 
TO authenticated 
USING (
    EXISTS (
        SELECT 1 FROM users 
        WHERE users.id = auth.uid() 
        AND users.is_admin = true
    )
);

-- Allow admins to insert
CREATE POLICY "Allow admins to insert system accounting codes" 
ON system_accounting_codes FOR INSERT 
TO authenticated 
WITH CHECK (
    EXISTS (
        SELECT 1 FROM users 
        WHERE users.id = auth.uid() 
        AND users.is_admin = true
    )
);