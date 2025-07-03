-- Drop the problematic policies that cause infinite recursion
DROP POLICY IF EXISTS "Admins can view all users" ON users;
DROP POLICY IF EXISTS "Admins can view all memberships" ON user_memberships;
DROP POLICY IF EXISTS "Admins can view all registrations" ON user_registrations;
DROP POLICY IF EXISTS "Only admins can modify seasons" ON seasons;
DROP POLICY IF EXISTS "Only admins can modify memberships" ON memberships;
DROP POLICY IF EXISTS "Only admins can modify registrations" ON registrations;

-- Create new policies without infinite recursion
-- For users table - allow inserts during user creation
CREATE POLICY "Allow user creation during auth" ON users
    FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can view their own profile" ON users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON users
    FOR UPDATE USING (auth.uid() = id);

-- Create a function to check admin status safely
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM auth.users 
        WHERE id = auth.uid() 
        AND raw_user_meta_data->>'is_admin' = 'true'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Alternative: Use a simpler admin check for now
-- We'll set admin status in auth metadata instead of the users table
CREATE POLICY "Service role can do anything on users" ON users
    FOR ALL USING (
        current_setting('role') = 'service_role'
    );

-- For now, allow authenticated users to insert their own user record
CREATE POLICY "Allow authenticated user self-insert" ON users
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL AND auth.uid() = id
    );

-- Temporarily allow all authenticated users to read basic data
CREATE POLICY "Authenticated users can view seasons" ON seasons 
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view memberships" ON memberships 
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view registrations" ON registrations 
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view pricing tiers" ON registration_pricing_tiers 
    FOR SELECT USING (auth.uid() IS NOT NULL);