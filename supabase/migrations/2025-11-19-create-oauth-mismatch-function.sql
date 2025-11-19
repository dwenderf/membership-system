-- Function to find users with email/OAuth mismatches
-- This identifies users where their account email differs from their Google OAuth email
CREATE OR REPLACE FUNCTION get_oauth_email_mismatches()
RETURNS TABLE (
  id UUID,
  account_email TEXT,
  oauth_email TEXT,
  first_name TEXT,
  last_name TEXT,
  last_sign_in_at TIMESTAMP WITH TIME ZONE,
  providers TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT
    au.id,
    au.email::TEXT AS account_email,
    (au.raw_user_meta_data->>'email')::TEXT AS oauth_email,
    u.first_name::TEXT,
    u.last_name::TEXT,
    au.last_sign_in_at,
    ARRAY(
      SELECT jsonb_array_elements_text(au.raw_app_meta_data->'providers')
    )::TEXT[] AS providers
  FROM auth.users au
  LEFT JOIN public.users u ON au.id = u.id
  WHERE
    -- User has Google OAuth (check providers array)
    au.raw_app_meta_data->'providers' ? 'google'
    -- Account email differs from OAuth email
    AND au.email IS DISTINCT FROM (au.raw_user_meta_data->>'email')::TEXT
    -- Exclude deleted/banned users
    AND au.deleted_at IS NULL
  ORDER BY au.last_sign_in_at DESC NULLS LAST;
END;
$$;

-- Grant execute permission to service_role only (for admin API use)
-- Regular authenticated users cannot call this function directly
GRANT EXECUTE ON FUNCTION get_oauth_email_mismatches() TO service_role;
