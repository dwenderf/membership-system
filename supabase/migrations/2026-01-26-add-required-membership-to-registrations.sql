-- Add required_membership_id to registrations table for hierarchical membership requirements
-- This allows registrations to specify a "default" membership requirement,
-- while categories can offer alternative (usually lower-tier) memberships.
--
-- Example: Registration requires "Standard Adult", but "Social" category accepts "Social" membership
--
-- Validation logic: User can register for a category if they have EITHER:
--   - registration.required_membership_id (if not NULL), OR
--   - category.required_membership_id (if not NULL)

ALTER TABLE registrations
ADD COLUMN required_membership_id UUID REFERENCES memberships(id);

-- Add index for performance
CREATE INDEX idx_registrations_required_membership
ON registrations(required_membership_id);

-- Add comment
COMMENT ON COLUMN registrations.required_membership_id IS
'Optional default membership requirement for this registration. Categories can specify alternative memberships via registration_categories.required_membership_id. User qualifies if they have EITHER the registration-level OR category-level membership.';
