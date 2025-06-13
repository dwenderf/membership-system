-- Drop ALL existing policies on users table to start fresh
DROP POLICY IF EXISTS "Users can view their own profile" ON users;
DROP POLICY IF EXISTS "Users can update their own profile" ON users;
DROP POLICY IF EXISTS "Admins can view all users" ON users;
DROP POLICY IF EXISTS "Allow user creation during auth" ON users;
DROP POLICY IF EXISTS "Service role can do anything on users" ON users;
DROP POLICY IF EXISTS "Allow authenticated user self-insert" ON users;

-- Drop problematic policies on other tables
DROP POLICY IF EXISTS "Admins can view all memberships" ON user_memberships;
DROP POLICY IF EXISTS "Admins can view all registrations" ON user_registrations;
DROP POLICY IF EXISTS "Only admins can modify seasons" ON seasons;
DROP POLICY IF EXISTS "Only admins can modify memberships" ON memberships;
DROP POLICY IF EXISTS "Only admins can modify registrations" ON registrations;

-- Create simple, non-recursive policies for users table
CREATE POLICY "users_select_own" ON users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users_insert_own" ON users
    FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "users_update_own" ON users
    FOR UPDATE USING (auth.uid() = id);

-- Allow service role (server-side) to do everything
CREATE POLICY "users_service_role_all" ON users
    FOR ALL USING (current_setting('role') = 'service_role');

-- Simple policies for other tables - authenticated users can read
CREATE POLICY "seasons_authenticated_read" ON seasons 
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "memberships_authenticated_read" ON memberships 
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "registrations_authenticated_read" ON registrations 
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "pricing_tiers_authenticated_read" ON registration_pricing_tiers 
    FOR SELECT USING (auth.uid() IS NOT NULL);