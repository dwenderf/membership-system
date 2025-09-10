-- Allow users to view discount codes they've used in their registrations
-- This enables the /user/registrations page to show discount code details
-- for alternate registrations without compromising security

CREATE POLICY "Users can view discount codes from their own registrations" 
ON discount_codes
FOR SELECT 
TO authenticated
USING (
    -- Allow if this discount code is used in any of the user's alternate registrations
    EXISTS (
        SELECT 1 FROM user_alternate_registrations uar 
        WHERE uar.discount_code_id = discount_codes.id 
        AND uar.user_id = auth.uid()
    )
);