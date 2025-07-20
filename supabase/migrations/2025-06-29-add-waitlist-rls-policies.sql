-- Add Row Level Security policies for waitlists table

-- Policy for users to view their own waitlist entries
CREATE POLICY "Users can view their own waitlist entries" ON waitlists
  FOR SELECT USING (auth.uid() = user_id);

-- Policy for users to insert their own waitlist entries
CREATE POLICY "Users can join waitlists" ON waitlists
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy for users to update their own waitlist entries (for future features like removing themselves)
CREATE POLICY "Users can update their own waitlist entries" ON waitlists
  FOR UPDATE USING (auth.uid() = user_id);

-- Policy for admins to view all waitlist entries
CREATE POLICY "Admins can view all waitlist entries" ON waitlists
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.is_admin = true
    )
  );

-- Policy for admins to update any waitlist entries (for admin management)
CREATE POLICY "Admins can manage all waitlist entries" ON waitlists
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.is_admin = true
    )
  );

-- Policy for admins to delete waitlist entries
CREATE POLICY "Admins can delete waitlist entries" ON waitlists
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.is_admin = true
    )
  );