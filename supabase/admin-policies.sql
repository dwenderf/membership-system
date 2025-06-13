-- Add admin policies for seasons management
-- First, drop the existing basic policy
DROP POLICY IF EXISTS "seasons_authenticated_read" ON seasons;

-- Create comprehensive policies for seasons
CREATE POLICY "seasons_public_read" ON seasons 
    FOR SELECT USING (TRUE); -- Anyone can read seasons

-- Allow admins to manage seasons
CREATE POLICY "seasons_admin_all" ON seasons
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.is_admin = TRUE
        )
    );

-- Same for memberships
DROP POLICY IF EXISTS "memberships_authenticated_read" ON memberships;

CREATE POLICY "memberships_public_read" ON memberships 
    FOR SELECT USING (TRUE);

CREATE POLICY "memberships_admin_all" ON memberships
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.is_admin = TRUE
        )
    );

-- Same for registrations
DROP POLICY IF EXISTS "registrations_authenticated_read" ON registrations;

CREATE POLICY "registrations_public_read" ON registrations 
    FOR SELECT USING (TRUE);

CREATE POLICY "registrations_admin_all" ON registrations
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.is_admin = TRUE
        )
    );