-- Add RLS policies for email_logs table

-- Email logs policies
CREATE POLICY "Users can view their own email logs" ON email_logs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can insert email logs" ON email_logs
    FOR INSERT WITH CHECK (true);

CREATE POLICY "System can update email logs" ON email_logs
    FOR UPDATE USING (true);

CREATE POLICY "Admins can view all email logs" ON email_logs
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );