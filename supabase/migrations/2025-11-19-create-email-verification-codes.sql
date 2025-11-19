-- Table to store email verification codes (OTP) temporarily
CREATE TABLE email_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  ip_address INET,
  user_agent TEXT
);

-- Index for cleanup and lookups
CREATE INDEX idx_email_verification_codes_expires ON email_verification_codes(expires_at);
CREATE INDEX idx_email_verification_codes_user_new_email ON email_verification_codes(user_id, new_email) WHERE used_at IS NULL;

-- RLS Policies
ALTER TABLE email_verification_codes ENABLE ROW LEVEL SECURITY;

-- Users can only see their own codes (for verification purposes)
CREATE POLICY "Users can view own verification codes"
  ON email_verification_codes FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Only API can insert/update (we'll use service role)
CREATE POLICY "Service role can manage codes"
  ON email_verification_codes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE email_verification_codes IS
  'Temporary storage for email verification OTP codes. Codes expire after 15 minutes.';
