-- Fix incomplete RLS policy on email_logs table
-- The "System can insert email logs" policy was missing its definition

-- Drop the incomplete policy
DROP POLICY IF EXISTS "System can insert email logs" ON email_logs;

-- Recreate the correct policy
CREATE POLICY "System can insert email logs" ON email_logs
    FOR INSERT WITH CHECK (true); 