-- Add allow_lgbtq_presale field to registrations table
-- This allows LGBTQ members to register during pre-sale without requiring a pre-sale code
ALTER TABLE registrations 
ADD COLUMN allow_lgbtq_presale BOOLEAN NOT NULL DEFAULT TRUE;

-- Add comment to document the field
COMMENT ON COLUMN registrations.allow_lgbtq_presale IS 'Whether LGBTQ members can register during pre-sale without requiring a pre-sale code'; 