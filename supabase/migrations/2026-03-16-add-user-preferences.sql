-- Add preferences JSONB column to users table
-- Stores user-specific preferences such as admin dashboard favorites

ALTER TABLE users
ADD COLUMN preferences JSONB;

COMMENT ON COLUMN users.preferences IS 'User preferences stored as JSON, e.g. { "adminFavorites": ["manage-seasons", ...] }';
