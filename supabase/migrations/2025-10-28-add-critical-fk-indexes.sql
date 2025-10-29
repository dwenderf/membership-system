-- Migration: Add indexes for critical foreign keys
-- Date: 2025-10-28
-- Purpose: Add indexes to foreign keys that are frequently used in query hot paths
--
-- Background:
-- Analysis of the codebase revealed 5 foreign keys that are heavily used in:
-- - Registration capacity checks (every registration attempt)
-- - Discount validation (every discounted payment)
-- - Refund operations (every refund lookup)
-- - Admin reporting (real-time queries)
--
-- Without these indexes, queries perform full table scans which will degrade
-- performance as the database grows.
--
-- Impact:
-- - Speeds up JOIN operations on these foreign keys
-- - Speeds up WHERE clause filtering by these columns
-- - Improves foreign key constraint validation performance
-- - No downside - these are all on high-traffic query paths

-- user_registrations.registration_id
-- Used to find all participants in a registration (25+ API routes)
-- Critical for: registration lists, capacity checks, participant reports
CREATE INDEX IF NOT EXISTS idx_user_registrations_registration_id
ON user_registrations(registration_id);

-- user_registrations.registration_category_id
-- Used to check category capacity on every registration attempt
-- Critical for: capacity management, category-level reporting
CREATE INDEX IF NOT EXISTS idx_user_registrations_registration_category_id
ON user_registrations(registration_category_id);

-- discount_usage.discount_code_id
-- Used to validate discount code usage limits on every discounted payment
-- Critical for: discount validation, usage tracking
CREATE INDEX IF NOT EXISTS idx_discount_usage_discount_code_id
ON discount_usage(discount_code_id);

-- discount_usage.season_id
-- Used to enforce per-season discount limits during validation
-- Critical for: seasonal discount rule enforcement
CREATE INDEX IF NOT EXISTS idx_discount_usage_season_id
ON discount_usage(season_id);

-- refunds.payment_id
-- Used to look up refund history for every refund operation
-- Critical for: refund validation, available amount calculation, refund history
CREATE INDEX IF NOT EXISTS idx_refunds_payment_id
ON refunds(payment_id);

-- Add comments explaining the purpose of each index
COMMENT ON INDEX idx_user_registrations_registration_id IS
'Speeds up queries that find all participants in a registration. Used heavily in admin reports and capacity checks.';

COMMENT ON INDEX idx_user_registrations_registration_category_id IS
'Speeds up category capacity checks performed on every registration attempt. Essential for capacity management.';

COMMENT ON INDEX idx_discount_usage_discount_code_id IS
'Speeds up discount code validation by quickly finding usage records. Prevents full table scans on every discounted payment.';

COMMENT ON INDEX idx_discount_usage_season_id IS
'Speeds up seasonal discount limit enforcement. Used during discount validation to check per-season usage.';

COMMENT ON INDEX idx_refunds_payment_id IS
'Speeds up refund history lookups and available refund amount calculations. Used on every refund operation.';
