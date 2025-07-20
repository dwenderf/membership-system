-- Fix RLS policies for discount code validation
-- Allow authenticated users to read active discount codes and categories for validation during checkout

-- Add policy to allow authenticated users to read discount codes for validation
CREATE POLICY "Users can read active discount codes for validation"
ON discount_codes
FOR SELECT
TO authenticated
USING (is_active = true);

-- Also allow users to read discount categories (needed for the join in validation)
CREATE POLICY "Users can read active discount categories for validation"
ON discount_categories
FOR SELECT  
TO authenticated
USING (is_active = true);