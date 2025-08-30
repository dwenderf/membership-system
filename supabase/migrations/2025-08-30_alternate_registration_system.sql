-- Migration: Alternate Registration System
-- Description: Add database schema for alternate registration system
-- Date: 2025-08-30

-- ============================================================================
-- 1. Add Setup Intent fields to users table
-- ============================================================================

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS stripe_setup_intent_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT,
ADD COLUMN IF NOT EXISTS setup_intent_status TEXT CHECK (setup_intent_status IN ('pending', 'succeeded', 'failed')),
ADD COLUMN IF NOT EXISTS payment_method_updated_at TIMESTAMP WITH TIME ZONE;

-- ============================================================================
-- 2. Add alternate configuration fields to registrations table
-- ============================================================================

ALTER TABLE registrations 
ADD COLUMN IF NOT EXISTS allow_alternates BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS alternate_price INTEGER, -- Price in cents for alternate spots
ADD COLUMN IF NOT EXISTS alternate_accounting_code TEXT; -- Accounting code for alternate revenue

-- ============================================================================
-- 3. Create user_alternate_registrations table
-- Description: Tracks which users want to be alternates for which registrations
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_alternate_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    discount_code_id UUID REFERENCES discount_codes(id), -- User's discount for this registration
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, registration_id) -- User can only register as alternate once per registration
);

-- ============================================================================
-- 4. Create alternate_registrations table
-- Description: Tracks games/events that need alternates (within a registration)
-- ============================================================================

CREATE TABLE IF NOT EXISTS alternate_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    game_description TEXT NOT NULL, -- "Game vs Team A on Jan 15"
    game_date TIMESTAMP WITH TIME ZONE, -- When the game happens
    created_by UUID NOT NULL REFERENCES users(id), -- Captain or admin who created this game
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 5. Create alternate_selections table
-- Description: Tracks which users are selected for specific games
-- ============================================================================

CREATE TABLE IF NOT EXISTS alternate_selections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alternate_registration_id UUID NOT NULL REFERENCES alternate_registrations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Which user is selected
    discount_code_id UUID REFERENCES discount_codes(id), -- Their discount (if any)
    payment_id UUID REFERENCES payments(id), -- Links to payment record
    amount_charged INTEGER NOT NULL, -- Final amount after discounts (in cents)
    selected_by UUID NOT NULL REFERENCES users(id), -- Captain or admin who selected
    selected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(alternate_registration_id, user_id) -- Prevents duplicate selections for same game
);

-- ============================================================================
-- 6. Create registration_captains table
-- Description: Tracks captain assignments for registrations
-- ============================================================================

CREATE TABLE IF NOT EXISTS registration_captains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    assigned_by UUID NOT NULL REFERENCES users(id),
    
    UNIQUE(registration_id, user_id) -- User can only be captain once per registration
);

-- ============================================================================
-- 7. Create indexes for performance
-- ============================================================================

-- Indexes for user_alternate_registrations
CREATE INDEX IF NOT EXISTS idx_user_alternate_registrations_user_id ON user_alternate_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_alternate_registrations_registration_id ON user_alternate_registrations(registration_id);
CREATE INDEX IF NOT EXISTS idx_user_alternate_registrations_discount_code_id ON user_alternate_registrations(discount_code_id);

-- Indexes for alternate_registrations
CREATE INDEX IF NOT EXISTS idx_alternate_registrations_registration_id ON alternate_registrations(registration_id);
CREATE INDEX IF NOT EXISTS idx_alternate_registrations_created_by ON alternate_registrations(created_by);
CREATE INDEX IF NOT EXISTS idx_alternate_registrations_game_date ON alternate_registrations(game_date);

-- Indexes for alternate_selections
CREATE INDEX IF NOT EXISTS idx_alternate_selections_alternate_registration_id ON alternate_selections(alternate_registration_id);
CREATE INDEX IF NOT EXISTS idx_alternate_selections_user_id ON alternate_selections(user_id);
CREATE INDEX IF NOT EXISTS idx_alternate_selections_selected_by ON alternate_selections(selected_by);
CREATE INDEX IF NOT EXISTS idx_alternate_selections_payment_id ON alternate_selections(payment_id);

-- Indexes for registration_captains
CREATE INDEX IF NOT EXISTS idx_registration_captains_registration_id ON registration_captains(registration_id);
CREATE INDEX IF NOT EXISTS idx_registration_captains_user_id ON registration_captains(user_id);

-- Indexes for users table new fields
CREATE INDEX IF NOT EXISTS idx_users_stripe_setup_intent_id ON users(stripe_setup_intent_id) WHERE stripe_setup_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_stripe_payment_method_id ON users(stripe_payment_method_id) WHERE stripe_payment_method_id IS NOT NULL;

-- Indexes for registrations table new fields
CREATE INDEX IF NOT EXISTS idx_registrations_allow_alternates ON registrations(allow_alternates) WHERE allow_alternates = TRUE;

-- ============================================================================
-- 8. Set up Row Level Security (RLS) policies
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE user_alternate_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE alternate_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE alternate_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_captains ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_alternate_registrations
-- Users can view and manage their own alternate registrations
CREATE POLICY "Users can view their own alternate registrations" ON user_alternate_registrations
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own alternate registrations" ON user_alternate_registrations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own alternate registrations" ON user_alternate_registrations
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own alternate registrations" ON user_alternate_registrations
    FOR DELETE USING (auth.uid() = user_id);

-- Admins and captains can view alternate registrations for their registrations
CREATE POLICY "Admins and captains can view alternate registrations" ON user_alternate_registrations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM registration_captains rc 
            WHERE rc.registration_id = user_alternate_registrations.registration_id 
            AND rc.user_id = auth.uid()
        )
        OR 
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.id = auth.uid() 
            AND u.is_admin = TRUE
        )
    );

-- RLS Policies for alternate_registrations (games)
-- Captains and admins can manage games for their registrations
CREATE POLICY "Captains and admins can view games" ON alternate_registrations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM registration_captains rc 
            WHERE rc.registration_id = alternate_registrations.registration_id 
            AND rc.user_id = auth.uid()
        )
        OR 
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.id = auth.uid() 
            AND u.is_admin = TRUE
        )
    );

CREATE POLICY "Captains and admins can create games" ON alternate_registrations
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM registration_captains rc 
            WHERE rc.registration_id = alternate_registrations.registration_id 
            AND rc.user_id = auth.uid()
        )
        OR 
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.id = auth.uid() 
            AND u.is_admin = TRUE
        )
    );

CREATE POLICY "Captains and admins can update games" ON alternate_registrations
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM registration_captains rc 
            WHERE rc.registration_id = alternate_registrations.registration_id 
            AND rc.user_id = auth.uid()
        )
        OR 
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.id = auth.uid() 
            AND u.is_admin = TRUE
        )
    );

CREATE POLICY "Captains and admins can delete games" ON alternate_registrations
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM registration_captains rc 
            WHERE rc.registration_id = alternate_registrations.registration_id 
            AND rc.user_id = auth.uid()
        )
        OR 
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.id = auth.uid() 
            AND u.is_admin = TRUE
        )
    );

-- RLS Policies for alternate_selections
-- Captains and admins can manage selections, users can view their own selections
CREATE POLICY "Users can view their own selections" ON alternate_selections
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Captains and admins can view selections" ON alternate_selections
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM alternate_registrations ar
            JOIN registration_captains rc ON rc.registration_id = ar.registration_id
            WHERE ar.id = alternate_selections.alternate_registration_id 
            AND rc.user_id = auth.uid()
        )
        OR 
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.id = auth.uid() 
            AND u.is_admin = TRUE
        )
    );

CREATE POLICY "Captains and admins can create selections" ON alternate_selections
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM alternate_registrations ar
            JOIN registration_captains rc ON rc.registration_id = ar.registration_id
            WHERE ar.id = alternate_selections.alternate_registration_id 
            AND rc.user_id = auth.uid()
        )
        OR 
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.id = auth.uid() 
            AND u.is_admin = TRUE
        )
    );

-- RLS Policies for registration_captains
-- Only admins can manage captain assignments
CREATE POLICY "Admins can manage captains" ON registration_captains
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.id = auth.uid() 
            AND u.is_admin = TRUE
        )
    );

-- Captains can view their own assignments
CREATE POLICY "Captains can view their assignments" ON registration_captains
    FOR SELECT USING (auth.uid() = user_id);

-- ============================================================================
-- 9. Add comments for documentation
-- ============================================================================

COMMENT ON TABLE user_alternate_registrations IS 'Tracks which users want to be alternates for which registrations';
COMMENT ON TABLE alternate_registrations IS 'Tracks games/events within registrations that need alternates';
COMMENT ON TABLE alternate_selections IS 'Tracks which users are selected for specific games';
COMMENT ON TABLE registration_captains IS 'Tracks captain assignments for registrations';

COMMENT ON COLUMN users.stripe_setup_intent_id IS 'Stripe Setup Intent ID for saving payment methods';
COMMENT ON COLUMN users.stripe_payment_method_id IS 'Saved payment method from Setup Intent';
COMMENT ON COLUMN users.setup_intent_status IS 'Status of the Setup Intent (pending, succeeded, failed)';
COMMENT ON COLUMN users.payment_method_updated_at IS 'When payment method was last updated';

COMMENT ON COLUMN registrations.allow_alternates IS 'Whether this registration allows alternates';
COMMENT ON COLUMN registrations.alternate_price IS 'Price in cents for alternate spots';
COMMENT ON COLUMN registrations.alternate_accounting_code IS 'Accounting code for alternate revenue';