-- Enable RLS on user_memberships_consolidated view
-- This view contains sensitive membership data and should be admin-only

-- Enable RLS on the view
ALTER VIEW user_memberships_consolidated ENABLE ROW LEVEL SECURITY;

-- Create admin-only policy for the view
-- Only users with is_admin = true can access this view
CREATE POLICY "Admin only access to consolidated memberships view" ON user_memberships_consolidated
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.is_admin = true
    )
  );

-- Add comment explaining the policy
COMMENT ON POLICY "Admin only access to consolidated memberships view" ON user_memberships_consolidated IS 
'Restricts access to the consolidated memberships view to admin users only. This view contains sensitive membership data across all users.';