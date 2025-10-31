-- Migration: Add missing admin policy for users table
-- Date: 2025-10-31
-- Purpose: Allow admin users to view all user records
--
-- Background:
-- The 2025-06-16-fix-policies-v2.sql migration dropped the "Admins can view all users"
-- policy but never recreated it. This causes issues when admins try to view user
-- information through joins (e.g., in pending invoices/payments on the accounting page).
--
-- Without this policy:
-- - Admins can query xero_invoices, xero_payments, and payments tables
-- - But when those queries join to the users table, RLS blocks the user data
-- - This results in "Unknown User" showing on the accounting page
--
-- Impact:
-- - Fixes missing user information on pending invoices and payments
-- - Allows admin users to view all user records as expected
-- - Maintains security by requiring is_admin = true

-- Add admin policy for users table
CREATE POLICY "users_admin_view_all" ON users
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users AS admin_check
            WHERE admin_check.id = auth.uid()
            AND admin_check.is_admin = true
        )
    );

-- Add comment explaining the policy
COMMENT ON POLICY "users_admin_view_all" ON users IS
'Allows admin users to view all user records. Required for admin features like viewing pending invoices with user information.';
