-- Email change requests with verification codes
CREATE TABLE email_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  verification_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'completed', 'expired', 'cancelled')),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  verified_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Index for finding active requests
CREATE INDEX idx_email_change_requests_user_status
  ON email_change_requests(user_id, status, expires_at)
  WHERE status IN ('pending', 'verified');

-- Index for cleanup of expired requests
CREATE INDEX idx_email_change_requests_expired
  ON email_change_requests(expires_at)
  WHERE status = 'pending';

-- RLS Policies
ALTER TABLE email_change_requests ENABLE ROW LEVEL SECURITY;

-- Users can only see their own requests
CREATE POLICY "Users can view own email change requests"
  ON email_change_requests FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Only insert through API (no direct insert policy)
COMMENT ON TABLE email_change_requests IS
  'Stores pending email change requests with verification codes. Insert only via API.';
