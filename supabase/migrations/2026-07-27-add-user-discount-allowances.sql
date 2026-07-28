-- Phase 2 Migration: Add user discount allowances schema and PRIDE placeholder code
-- Created: 2026-07-27
-- Manual maintainer application only. Do not run via CLI.

-- 1. Add columns to discount_categories
ALTER TABLE discount_categories
ADD COLUMN IF NOT EXISTS requires_user_allowance BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS default_percentage DECIMAL(5,2) CHECK (default_percentage IS NULL OR (default_percentage > 0 AND default_percentage <= 100)),
ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;

-- 2. Add columns and constraints to discount_codes
ALTER TABLE discount_codes
ADD COLUMN IF NOT EXISTS uses_user_allowance BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE discount_codes
ALTER COLUMN percentage DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_discount_codes_percentage_or_allowance'
    ) THEN
        ALTER TABLE discount_codes
        ADD CONSTRAINT chk_discount_codes_percentage_or_allowance
        CHECK (percentage IS NOT NULL OR uses_user_allowance);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_discount_codes_one_allowance_code_per_category
ON discount_codes (discount_category_id) WHERE uses_user_allowance;

-- 3. Create user_discount_allowances table
CREATE TABLE IF NOT EXISTS user_discount_allowances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    discount_category_id UUID NOT NULL REFERENCES discount_categories(id) ON DELETE CASCADE,
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    discount_percentage DECIMAL(5,2) CHECK (discount_percentage IS NULL OR (discount_percentage > 0 AND discount_percentage <= 100)),
    max_discount_amount INTEGER CHECK (max_discount_amount IS NULL OR max_discount_amount >= 0),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uq_user_discount_allowance_user_cat_season UNIQUE (user_id, discount_category_id, season_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_discount_allowance_user_season_default
ON user_discount_allowances (user_id, season_id) WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_uda_season_category ON user_discount_allowances(season_id, discount_category_id);
CREATE INDEX IF NOT EXISTS idx_uda_created_by ON user_discount_allowances(created_by);
CREATE INDEX IF NOT EXISTS idx_uda_updated_by ON user_discount_allowances(updated_by);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_user_discount_allowances_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_discount_allowances_updated_at ON user_discount_allowances;
CREATE TRIGGER trg_user_discount_allowances_updated_at
BEFORE UPDATE ON user_discount_allowances
FOR EACH ROW
EXECUTE FUNCTION update_user_discount_allowances_updated_at();

-- Enable RLS
ALTER TABLE user_discount_allowances ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'user_discount_allowances_admin_all' AND tablename = 'user_discount_allowances'
    ) THEN
        CREATE POLICY "user_discount_allowances_admin_all" ON user_discount_allowances
            FOR ALL USING (
                EXISTS (
                    SELECT 1 FROM users
                    WHERE id = auth.uid() AND is_admin = TRUE
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'user_discount_allowances_user_read_own' AND tablename = 'user_discount_allowances'
    ) THEN
        CREATE POLICY "user_discount_allowances_user_read_own" ON user_discount_allowances
            FOR SELECT USING (
                auth.uid() = user_id
            );
    END IF;
END $$;

-- 4. Seed dormant PRIDE code for Financial Aid category
DO $$
DECLARE
    v_category_id UUID;
BEGIN
    SELECT discount_category_id INTO v_category_id
    FROM discount_codes
    WHERE code = 'PRIDE50'
    LIMIT 1;

    IF v_category_id IS NOT NULL THEN
        INSERT INTO discount_codes (code, percentage, discount_category_id, uses_user_allowance, is_active)
        VALUES ('PRIDE', NULL, v_category_id, TRUE, FALSE)
        ON CONFLICT (code) DO NOTHING;
    ELSE
        RAISE NOTICE 'Financial Aid category code PRIDE50 not found; PRIDE placeholder creation skipped.';
    END IF;
END $$;
