-- Migration: Fix is_admin_user function search path
-- Date: 2025-10-28
-- Purpose: Add explicit search_path to is_admin_user function
--
-- Background:
-- The is_admin_user() function is used in RLS policies and needs a fixed search_path
-- to prevent search_path injection attacks.

-- Fix the is_admin_user() function
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM auth.users
        WHERE id = auth.uid()
        AND raw_user_meta_data->>'is_admin' = 'true'
    );
END;
$$;

-- Add comment
COMMENT ON FUNCTION is_admin_user() IS
'Checks if the current user has admin privileges by checking auth metadata. Fixed search_path for security.';
