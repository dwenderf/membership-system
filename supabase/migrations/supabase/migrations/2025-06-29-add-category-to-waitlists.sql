-- Add registration_category_id to waitlists table for category-specific waitlists
-- This allows users to join waitlists for specific categories within a registration

ALTER TABLE waitlists 
ADD COLUMN registration_category_id UUID REFERENCES registration_categories(id) ON DELETE CASCADE;

-- Update the unique constraint to include category
ALTER TABLE waitlists 
DROP CONSTRAINT waitlists_user_id_registration_id_key;

ALTER TABLE waitlists 
ADD CONSTRAINT waitlists_user_category_unique UNIQUE(user_id, registration_id, registration_category_id);

-- Add index for efficient category-specific waitlist queries
CREATE INDEX idx_waitlists_category ON waitlists(registration_category_id, position, removed_at);

-- Comment for clarity
COMMENT ON COLUMN waitlists.registration_category_id IS 'Specific category within the registration that the user is waitlisted for';