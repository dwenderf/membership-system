-- Function to query auth audit logs (admin only)
CREATE OR REPLACE FUNCTION get_auth_audit_logs(
  target_user_id UUID DEFAULT NULL,
  limit_count INT DEFAULT 50,
  offset_count INT DEFAULT 0,
  start_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  end_date TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  created_at TIMESTAMP WITH TIME ZONE,
  ip_address TEXT,
  user_id UUID,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  action TEXT,
  payload JSON
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Verify caller is admin
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    aal.id,
    aal.created_at,
    aal.ip_address::TEXT,
    (aal.payload->>'actor_id')::UUID as user_id,
    COALESCE(u.email, aal.payload->>'actor_username') as email,
    u.first_name,
    u.last_name,
    aal.payload->>'action' as action,
    aal.payload
  FROM auth.audit_log_entries aal
  LEFT JOIN users u ON u.id = (aal.payload->>'actor_id')::UUID
  WHERE
    CASE
      WHEN target_user_id IS NOT NULL
      THEN (aal.payload->>'actor_id')::UUID = target_user_id
      ELSE true
    END
    AND CASE
      WHEN start_date IS NOT NULL
      THEN aal.created_at >= start_date
      ELSE true
    END
    AND CASE
      WHEN end_date IS NOT NULL
      THEN aal.created_at <= end_date
      ELSE true
    END
  ORDER BY aal.created_at DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$;

-- Grant execute to authenticated users (function checks admin internally)
GRANT EXECUTE ON FUNCTION get_auth_audit_logs TO authenticated;

COMMENT ON FUNCTION get_auth_audit_logs IS
  'Admin-only function to query Supabase auth audit logs. Filters by user_id and date range if provided.';
