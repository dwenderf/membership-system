-- Drop the problematic admin policies
DROP POLICY IF EXISTS "seasons_admin_all" ON seasons;
DROP POLICY IF EXISTS "memberships_admin_all" ON memberships;
DROP POLICY IF EXISTS "registrations_admin_all" ON registrations;

-- Create simpler policies that don't cause recursion issues
-- Allow any authenticated user to manage seasons for now (we'll refine this later)
CREATE POLICY "seasons_authenticated_all" ON seasons
    FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "memberships_authenticated_all" ON memberships
    FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "registrations_authenticated_all" ON registrations
    FOR ALL USING (auth.uid() IS NOT NULL);

-- Also add policies for the other tables we'll need
CREATE POLICY "registration_pricing_tiers_authenticated_all" ON registration_pricing_tiers
    FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "discount_codes_authenticated_all" ON discount_codes
    FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "access_codes_authenticated_all" ON access_codes
    FOR ALL USING (auth.uid() IS NOT NULL);