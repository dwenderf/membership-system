-- Add RLS policies for discount_usage table
-- 
-- Users should be able to view their own discount usage for limit checking
-- Admins should be able to view all discount usage for management
--
-- Created: 2025-07-15
-- Purpose: Fix discount usage limit checking by allowing users to query their own usage

-- Users can view their own discount usage (needed for limit checking)
CREATE POLICY "Users can view their own discount usage" ON discount_usage
    FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own discount usage (needed when discounts are applied)
CREATE POLICY "Users can insert their own discount usage" ON discount_usage
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Admins can view all discount usage
CREATE POLICY "Admins can view all discount usage" ON discount_usage
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

COMMENT ON POLICY "Users can view their own discount usage" ON discount_usage IS 'Allows users to query their own discount usage for limit enforcement';
COMMENT ON POLICY "Users can insert their own discount usage" ON discount_usage IS 'Allows users to record discount usage when discounts are applied';
COMMENT ON POLICY "Admins can view all discount usage" ON discount_usage IS 'Allows admins to view all discount usage for management and reporting'; 