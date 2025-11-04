-- Rollback script for payment plans migration
-- Run this if you need to undo the payment plans changes

-- Warning: This will delete all payment plan data!
-- Only run this if you're sure you want to completely remove the payment plans feature

-- 1. Drop triggers
DROP TRIGGER IF EXISTS update_payment_plans_updated_at ON payment_plans;
DROP TRIGGER IF EXISTS update_payment_plan_transactions_updated_at ON payment_plan_transactions;

-- 2. Drop tables (CASCADE will drop dependent foreign keys)
DROP TABLE IF EXISTS payment_plan_transactions CASCADE;
DROP TABLE IF EXISTS payment_plans CASCADE;

-- 3. Drop indexes on users table
DROP INDEX IF EXISTS idx_users_payment_plan_enabled;

-- 4. Remove column from users table
ALTER TABLE users DROP COLUMN IF EXISTS payment_plan_enabled;
