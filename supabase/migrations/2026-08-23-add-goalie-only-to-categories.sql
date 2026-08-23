-- Add goalie-only flag to master categories table
-- When true, only users with users.is_goalie = true may register in a
-- registration_category that references this category.

ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_goalie_only BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN categories.is_goalie_only IS 'When true, only members who have identified as a goalie (users.is_goalie) may register in registration categories that reference this master category.';
