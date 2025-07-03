-- Fix RLS policy to allow users to insert their own memberships
-- This is needed for the membership purchase flow

-- Add INSERT policy for users to create their own memberships
CREATE POLICY "Users can insert their own memberships" ON user_memberships
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Also ensure UPDATE policy exists for users to update their own memberships  
CREATE POLICY "Users can update their own memberships" ON user_memberships
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);