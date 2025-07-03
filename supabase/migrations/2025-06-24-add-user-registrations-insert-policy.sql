-- Add missing INSERT policy for user_registrations table
-- This allows users to create their own registration records through the API

CREATE POLICY "Users can insert their own registrations" ON user_registrations
    FOR INSERT WITH CHECK (auth.uid() = user_id);