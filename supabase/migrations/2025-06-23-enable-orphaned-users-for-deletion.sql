-- Enable account deletion while preserving business data
-- Remove foreign key constraint to allow auth.users deletion without affecting business records

BEGIN;

-- Drop the foreign key constraint to auth.users
-- This allows us to delete auth.users while preserving business data in public.users
ALTER TABLE users DROP CONSTRAINT users_id_fkey;

-- Add a comment to document the relationship
COMMENT ON COLUMN users.id IS 'UUID that matches auth.users.id when active, preserved as orphaned record when auth user is deleted';

-- Ensure we have an index on deleted_at for performance
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);

COMMIT;