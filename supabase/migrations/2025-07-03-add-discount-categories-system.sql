-- Add comprehensive category-based discount system
-- 
-- Creates discount categories for organizational grouping with accounting codes
-- Updates discount codes to reference categories
-- Updates discount usage tracking for category-based limits
--
-- Created: 2025-07-03
-- Purpose: Implement Phase 1 of category-based discount system

-- Create discount categories table
CREATE TABLE discount_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    accounting_code TEXT NOT NULL,
    max_discount_per_user_per_season INTEGER, -- In cents, NULL = no limit
    is_active BOOLEAN DEFAULT TRUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure unique category names and accounting codes
    CONSTRAINT uq_discount_categories_name UNIQUE (name),
    CONSTRAINT uq_discount_categories_accounting_code UNIQUE (accounting_code),
    
    -- Validate max discount is positive if set
    CONSTRAINT chk_max_discount_positive CHECK (max_discount_per_user_per_season IS NULL OR max_discount_per_user_per_season > 0)
);

-- Enable RLS on discount categories
ALTER TABLE discount_categories ENABLE ROW LEVEL SECURITY;

-- Add category reference to discount_codes table
ALTER TABLE discount_codes ADD COLUMN discount_category_id UUID REFERENCES discount_categories(id);

-- Update discount_codes table structure
-- Remove old fields that are now handled by categories
ALTER TABLE discount_codes DROP COLUMN IF EXISTS name;
ALTER TABLE discount_codes DROP COLUMN IF EXISTS max_discount_per_user_per_season;
ALTER TABLE discount_codes DROP COLUMN IF EXISTS accounting_code;

-- Add category reference to discount_usage table for fast category-based queries
ALTER TABLE discount_usage ADD COLUMN discount_category_id UUID REFERENCES discount_categories(id);
ALTER TABLE discount_usage ADD COLUMN registration_id UUID REFERENCES registrations(id);

-- Remove old transaction_id field (replaced with registration_id for clearer tracking)
ALTER TABLE discount_usage DROP COLUMN IF EXISTS transaction_id;

-- Create indexes for performance
CREATE INDEX idx_discount_codes_category_id ON discount_codes(discount_category_id);
CREATE INDEX idx_discount_usage_category_season ON discount_usage(user_id, discount_category_id, season_id);
CREATE INDEX idx_discount_usage_registration ON discount_usage(registration_id);

-- Add RLS policies for discount categories (admin-only management)
CREATE POLICY "discount_categories_admin_only" ON discount_categories
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Add constraint to ensure discount_codes have category_id after migration
-- This will be enforced after we populate existing codes with categories
-- ALTER TABLE discount_codes ALTER COLUMN discount_category_id SET NOT NULL;

-- Add constraint to ensure discount_usage has category_id after migration  
-- This will be enforced after we populate existing usage with categories
-- ALTER TABLE discount_usage ALTER COLUMN discount_category_id SET NOT NULL;

-- Create sample discount categories for common organizational uses
INSERT INTO discount_categories (name, accounting_code, max_discount_per_user_per_season, description) VALUES
('Scholarship Fund', 'DISCOUNT-SCHOLAR', 50000, 'Need-based scholarships with $500 per season limit'),
('Board Member', 'DISCOUNT-BOARD', NULL, 'Board member recognition discounts with no limit'),
('Captain', 'DISCOUNT-CAPTAIN', NULL, 'Team captain appreciation discounts'),
('Volunteer', 'DISCOUNT-VOLUNTEER', 25000, 'Volunteer recognition with $250 per season limit');

COMMENT ON TABLE discount_categories IS 'Organizational groupings for discount codes with accounting integration';
COMMENT ON COLUMN discount_categories.accounting_code IS 'Xero accounting code for financial reporting';
COMMENT ON COLUMN discount_categories.max_discount_per_user_per_season IS 'Maximum discount amount per user per season in cents, NULL for unlimited';

COMMENT ON COLUMN discount_codes.discount_category_id IS 'Category for organizational grouping and accounting';
COMMENT ON COLUMN discount_usage.discount_category_id IS 'Denormalized category reference for fast limit queries';
COMMENT ON COLUMN discount_usage.registration_id IS 'Registration where discount was applied for audit trail';