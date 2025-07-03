-- Add presale_code_used field to user_registrations table
-- This will track which presale code was used for a registration (if any)

ALTER TABLE user_registrations 
ADD COLUMN presale_code_used TEXT NULL;

-- Add a comment to explain the field
COMMENT ON COLUMN user_registrations.presale_code_used IS 'Stores the presale code that was used for this registration (if any). NULL if no presale code was used.';