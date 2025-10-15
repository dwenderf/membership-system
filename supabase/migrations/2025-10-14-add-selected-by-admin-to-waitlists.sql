-- Add selected_by_admin_id column to waitlists table
-- This tracks which admin user selected a person from the waitlist

ALTER TABLE waitlists
ADD COLUMN selected_by_admin_id uuid REFERENCES users(id);

COMMENT ON COLUMN waitlists.selected_by_admin_id IS 'The admin user who selected this person from the waitlist';
