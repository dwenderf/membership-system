-- Migration: Fix SECURITY DEFINER on user_memberships_consolidated view
-- Date: 2025-10-28
-- Purpose: Remove SECURITY DEFINER to fix Supabase linter warning
--
-- Background:
-- The view already has RLS enabled with admin-only policy, so SECURITY DEFINER
-- is not needed and actually creates a security concern by bypassing RLS checks
-- on the underlying tables.

-- Recreate the view without SECURITY DEFINER (default is SECURITY INVOKER)
CREATE OR REPLACE VIEW user_memberships_consolidated
WITH (security_invoker = true)
AS
SELECT
  um.user_id,
  um.membership_id,
  m.name as membership_name,
  m.description as membership_description,
  MAX(um.valid_until) as latest_expiration,
  MIN(um.valid_from) as member_since,
  MAX(um.valid_until) >= CURRENT_DATE as is_active
FROM user_memberships um
INNER JOIN memberships m ON m.id = um.membership_id
WHERE um.payment_status = 'paid'  -- Only include paid memberships
GROUP BY
  um.user_id,
  um.membership_id,
  m.name,
  m.description
ORDER BY latest_expiration DESC;

-- Restore the comment
COMMENT ON VIEW user_memberships_consolidated IS
'Consolidated view of user memberships grouped by membership type. Shows latest expiration date and active status for each membership type per user. Uses SECURITY INVOKER to respect RLS policies on underlying tables.';
