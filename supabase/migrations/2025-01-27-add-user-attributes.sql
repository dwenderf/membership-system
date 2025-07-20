-- Add user attributes for registration filtering
-- is_lgbtq is nullable (user can decline to answer)
-- is_goalie is required (defaults to false)

ALTER TABLE users ADD COLUMN is_lgbtq BOOLEAN;
ALTER TABLE users ADD COLUMN is_goalie BOOLEAN NOT NULL DEFAULT false;

-- Add indexes for efficient filtering queries
CREATE INDEX idx_users_is_lgbtq ON users(is_lgbtq) WHERE is_lgbtq = true;
CREATE INDEX idx_users_is_goalie ON users(is_goalie) WHERE is_goalie = true;

-- Add comments for documentation
COMMENT ON COLUMN users.is_lgbtq IS 'Whether the user identifies as LGBTQ. Null means they prefer not to answer.';
COMMENT ON COLUMN users.is_goalie IS 'Whether the user plays goalie (including if they primarily play out but also play goalie).'; 