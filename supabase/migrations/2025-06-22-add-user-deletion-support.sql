-- Migration: Add user account deletion support
-- Created: 2025-06-22
-- Purpose: Add deleted_at field to support account deletion/anonymization

-- Add deleted_at field to users table
ALTER TABLE users 
ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;

-- Add index for performance when filtering out deleted users
CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN users.deleted_at IS 'Timestamp when user account was deleted/anonymized. NULL means active account.';