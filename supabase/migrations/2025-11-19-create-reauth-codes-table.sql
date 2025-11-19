-- Create table for re-authentication verification codes
CREATE TABLE reauth_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL, -- Hashed code for security
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  failed_attempts INT DEFAULT 0,
  ip_address INET,
  user_agent TEXT,
  CONSTRAINT max_failed_attempts CHECK (failed_attempts <= 5)
);

-- Index for fast lookups
CREATE INDEX idx_reauth_codes_user_id ON reauth_verification_codes(user_id);
CREATE INDEX idx_reauth_codes_expires_at ON reauth_verification_codes(expires_at);

-- RLS Policies (service role only)
ALTER TABLE reauth_verification_codes ENABLE ROW LEVEL SECURITY;

-- No direct access from users - only via API with service role
CREATE POLICY "Service role only" ON reauth_verification_codes
  FOR ALL
  USING (false);

-- Function to clean up expired codes (run periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_reauth_codes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM reauth_verification_codes
  WHERE expires_at < NOW();
END;
$$;

-- Grant execute to authenticated users (API will call this)
GRANT EXECUTE ON FUNCTION cleanup_expired_reauth_codes() TO authenticated;

COMMENT ON TABLE reauth_verification_codes IS 'Stores temporary verification codes for re-authentication before sensitive operations like email changes';
COMMENT ON COLUMN reauth_verification_codes.code_hash IS 'SHA-256 hash of the 6-digit verification code';
COMMENT ON COLUMN reauth_verification_codes.failed_attempts IS 'Number of failed verification attempts - locked after 5 failures';
