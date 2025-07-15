-- Fix broken RLS policy on discount_usage table
-- The original policy had a syntax error with an orphaned FOR INSERT clause

-- Drop the broken policy
DROP POLICY IF EXISTS "Admins can view all discount usage" ON discount_usage;

-- Recreate the correct policy
CREATE POLICY "Admins can view all discount usage" ON discount_usage
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    ); 