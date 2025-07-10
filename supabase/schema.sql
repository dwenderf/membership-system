-- Hockey Association Membership System Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (business data independent of auth.users lifecycle)
-- When auth.users is deleted, this record becomes "orphaned" but preserves business data
CREATE TABLE users (
    id UUID PRIMARY KEY, -- Matches auth.users.id when active, preserved as orphaned record when auth user is deleted
    email TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT,
    is_admin BOOLEAN DEFAULT FALSE,
    tags TEXT[] DEFAULT '{}',
    member_id INTEGER UNIQUE, -- Auto-generated unique member ID starting from 1000. Used for Xero contact identification.
    onboarding_completed_at TIMESTAMP WITH TIME ZONE,
    terms_accepted_at TIMESTAMP WITH TIME ZONE,
    terms_version TEXT,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Member ID sequence and functions
CREATE SEQUENCE IF NOT EXISTS member_id_seq START 1000;

-- Function to generate member ID
CREATE OR REPLACE FUNCTION generate_member_id() RETURNS INTEGER AS $$
BEGIN
    RETURN nextval('member_id_seq');
END;
$$ LANGUAGE plpgsql;

-- Function to auto-generate member_id on insert
CREATE OR REPLACE FUNCTION set_member_id_on_insert() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.member_id IS NULL THEN
        NEW.member_id := generate_member_id();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for users table to auto-generate member_id
DROP TRIGGER IF EXISTS set_member_id_trigger ON users;
CREATE TRIGGER set_member_id_trigger
    BEFORE INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_member_id_on_insert();

-- Index for member_id performance
CREATE INDEX IF NOT EXISTS idx_users_member_id ON users(member_id);

-- Login attempts table
CREATE TABLE login_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    email TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('magic_link', 'google', 'apple')),
    ip_address INET NOT NULL,
    user_agent TEXT,
    success BOOLEAN NOT NULL,
    failure_reason TEXT,
    attempted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Magic link tokens table
CREATE TABLE magic_link_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    ip_address INET NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- System accounting codes table
CREATE TABLE system_accounting_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_type TEXT NOT NULL,
    accounting_code TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT unique_code_type UNIQUE(code_type)
);

-- Insert default system accounting codes
INSERT INTO system_accounting_codes (code_type, accounting_code, description) VALUES
('donation_received_default', null, 'Default accounting code for donations received (line items in invoices)'),
('donation_given_default', null, 'Default accounting code for financial assistance/discounts given'),
('registration_default', null, 'Default accounting code for registration categories without specific codes');

-- Seasons table
CREATE TABLE seasons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('fall_winter', 'spring_summer')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Memberships table (flexible membership types)
CREATE TABLE memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    price_monthly INTEGER NOT NULL, -- in cents
    price_annual INTEGER NOT NULL, -- in cents
    accounting_code TEXT,
    allow_discounts BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure annual pricing offers some discount
    CONSTRAINT chk_annual_pricing CHECK (price_annual <= price_monthly * 12)
);

-- User memberships table (duration-based purchases)
-- Stores individual membership purchases. Users can have multiple records 
-- for the same membership type to support extensions and renewals.
CREATE TABLE user_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    valid_from DATE NOT NULL,
    valid_until DATE NOT NULL,
    months_purchased INTEGER,
    payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'paid', 'refunded')),
    stripe_payment_intent_id TEXT,
    amount_paid INTEGER, -- in cents
    purchased_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure valid_until > valid_from
    CONSTRAINT chk_membership_validity CHECK (valid_until > valid_from)
    -- Note: No unique constraint on (user_id, membership_id) to allow extensions/renewals
);

-- Registrations table
CREATE TABLE registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('team', 'scrimmage', 'event')),
    allow_discounts BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT FALSE, -- Whether registration is published (false = draft/hidden from users)
    presale_start_at TIMESTAMP WITH TIME ZONE, -- When pre-sale registration opens (requires presale_code)
    regular_start_at TIMESTAMP WITH TIME ZONE, -- When general registration opens to all users
    registration_end_at TIMESTAMP WITH TIME ZONE, -- When registration closes
    presale_code TEXT, -- Code required for pre-sale access
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Master categories table
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    category_type TEXT NOT NULL CHECK (category_type IN ('system', 'user')),
    created_by UUID REFERENCES users(id), -- NULL for system categories
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure no duplicate names within the same type
    UNIQUE(name, category_type)
);

-- Registration categories table
CREATE TABLE registration_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id), -- NULL for one-off custom
    custom_name TEXT, -- Used when category_id is NULL
    price INTEGER NOT NULL, -- Price in cents (no default - must be set explicitly)
    max_capacity INTEGER,
    accounting_code TEXT, -- accounting code for this category
    required_membership_id UUID REFERENCES memberships(id), -- Category-specific membership requirement
    sort_order INTEGER DEFAULT 0, -- for display ordering
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Must have either category_id OR custom_name, not both
    CONSTRAINT check_category_or_custom CHECK (
        (category_id IS NOT NULL AND custom_name IS NULL) OR 
        (category_id IS NULL AND custom_name IS NOT NULL)
    ),
    -- Ensure no duplicate categories within a registration
    UNIQUE(registration_id, category_id),
    UNIQUE(registration_id, custom_name)
);

-- User registrations table
-- User registration records with reservation system. 
-- Flow: processing (reserved) -> paid (confirmed) or deleted (expired/failed).
CREATE TABLE user_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    registration_category_id UUID REFERENCES registration_categories(id),
    user_membership_id UUID REFERENCES user_memberships(id), -- NULL for free events
    payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'paid', 'refunded', 'processing')),
    registration_fee INTEGER, -- in cents
    amount_paid INTEGER, -- in cents (after discounts)
    presale_code_used TEXT, -- Stores the presale code used for this registration (if any)
    processing_expires_at TIMESTAMP WITH TIME ZONE, -- Expiration time for processing reservations. Used to prevent race conditions by reserving spots for 5 minutes while payment is processed.
    registered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, registration_id)
);

-- Registration pricing tiers table
CREATE TABLE registration_pricing_tiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    registration_category_id UUID REFERENCES registration_categories(id), -- NULL = applies to all categories
    tier_name TEXT NOT NULL,
    price INTEGER NOT NULL, -- in cents
    starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
    requires_code BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(registration_id, tier_name)
);

-- Discount categories table for organizational grouping
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

-- Discount codes table (updated for category-based system)
CREATE TABLE discount_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    discount_category_id UUID NOT NULL REFERENCES discount_categories(id),
    code TEXT UNIQUE NOT NULL,
    percentage DECIMAL(5,2) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    valid_from TIMESTAMP WITH TIME ZONE,
    valid_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Discount usage tracking table (updated for category-based limits)
CREATE TABLE discount_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    discount_code_id UUID NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
    discount_category_id UUID NOT NULL REFERENCES discount_categories(id), -- Denormalized for fast queries
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    amount_saved INTEGER NOT NULL, -- in cents
    used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    registration_id UUID REFERENCES registrations(id) -- What they used it on
);

-- Access codes table
CREATE TABLE access_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('pre_sale', 'waitlist_bypass')),
    registration_id UUID REFERENCES registrations(id), -- NULL for pre-sale codes
    generated_by UUID NOT NULL REFERENCES users(id),
    is_single_use BOOLEAN NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Access code usage table
CREATE TABLE access_code_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    access_code_id UUID NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(access_code_id, user_id, registration_id)
);

-- Waitlists table
CREATE TABLE waitlists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    registration_category_id UUID REFERENCES registration_categories(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    bypass_code_generated BOOLEAN DEFAULT FALSE,
    bypass_code_id UUID REFERENCES access_codes(id),
    removed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, registration_id, registration_category_id)
);

-- Payments table
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_amount INTEGER NOT NULL, -- in cents
    discount_amount INTEGER DEFAULT 0, -- in cents
    final_amount INTEGER NOT NULL, -- in cents
    stripe_payment_intent_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    payment_method TEXT DEFAULT 'stripe',
    refund_reason TEXT,
    refunded_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Payment items table
CREATE TABLE payment_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK (item_type IN ('membership', 'registration')),
    item_id UUID NOT NULL,
    amount INTEGER NOT NULL, -- in cents
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Payment configurations table
CREATE TABLE payment_configurations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider TEXT NOT NULL,
    is_active BOOLEAN DEFAULT FALSE,
    is_primary BOOLEAN DEFAULT FALSE,
    configuration JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email logs table
CREATE TABLE email_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email_address TEXT NOT NULL,
    event_type TEXT NOT NULL,
    subject TEXT NOT NULL,
    template_id TEXT,
    loops_event_id TEXT,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'bounced', 'spam')),
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE,
    first_clicked_at TIMESTAMP WITH TIME ZONE,
    bounced_at TIMESTAMP WITH TIME ZONE,
    bounce_reason TEXT,
    email_data JSONB,
    triggered_by TEXT CHECK (triggered_by IN ('user_action', 'admin_send', 'automated')),
    triggered_by_user_id UUID, -- References users(id) but no foreign key constraint
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- Create indexes for performance
CREATE INDEX idx_users_deleted_at ON users(deleted_at);
CREATE INDEX idx_login_attempts_user_id_time ON login_attempts(user_id, attempted_at);
CREATE INDEX idx_login_attempts_email_time ON login_attempts(email, attempted_at);
CREATE INDEX idx_login_attempts_ip_time ON login_attempts(ip_address, attempted_at);
CREATE INDEX idx_magic_link_tokens_token ON magic_link_tokens(token);
CREATE INDEX idx_magic_link_tokens_email_expires ON magic_link_tokens(email, expires_at);
CREATE INDEX idx_categories_type ON categories(category_type);
CREATE INDEX idx_categories_created_by ON categories(created_by);
CREATE INDEX idx_registration_categories_registration ON registration_categories(registration_id);
CREATE INDEX idx_registration_categories_category ON registration_categories(category_id);
CREATE INDEX idx_registration_categories_membership ON registration_categories(required_membership_id);
CREATE INDEX idx_registration_pricing_tiers_reg_starts ON registration_pricing_tiers(registration_id, starts_at);
CREATE INDEX idx_registration_pricing_tiers_category ON registration_pricing_tiers(registration_category_id);
CREATE INDEX idx_access_codes_code_type_active ON access_codes(code, type, is_active);
CREATE INDEX idx_discount_usage_user_season ON discount_usage(user_id, season_id);
CREATE INDEX idx_discount_usage_code_time ON discount_usage(discount_code_id, used_at);
CREATE INDEX idx_waitlists_registration_position ON waitlists(registration_id, position);
CREATE INDEX idx_waitlists_registration_time ON waitlists(registration_id, joined_at);
CREATE INDEX idx_waitlists_category ON waitlists(registration_category_id, position, removed_at);
CREATE INDEX idx_user_registrations_processing_expires ON user_registrations(processing_expires_at) WHERE payment_status = 'processing';

CREATE INDEX idx_payments_user_time ON payments(user_id, created_at);
CREATE INDEX idx_payments_stripe_intent ON payments(stripe_payment_intent_id);
CREATE INDEX idx_payments_xero_synced ON payments(xero_synced);
CREATE INDEX idx_user_memberships_xero_synced ON user_memberships(xero_synced);
CREATE INDEX idx_user_registrations_xero_synced ON user_registrations(xero_synced);
CREATE INDEX idx_email_logs_user_time ON email_logs(user_id, sent_at);
CREATE INDEX idx_email_logs_event_time ON email_logs(event_type, sent_at);
CREATE INDEX idx_email_logs_status_time ON email_logs(status, sent_at);

-- Xero Integration Indexes
CREATE INDEX idx_xero_oauth_tokens_tenant_id ON xero_oauth_tokens(tenant_id);
CREATE INDEX idx_xero_oauth_tokens_expires_at ON xero_oauth_tokens(expires_at);
CREATE INDEX idx_xero_contacts_user_id ON xero_contacts(user_id);
CREATE INDEX idx_xero_contacts_tenant_id ON xero_contacts(tenant_id);
CREATE INDEX idx_xero_contacts_xero_contact_id ON xero_contacts(xero_contact_id);
CREATE INDEX idx_xero_contacts_sync_status ON xero_contacts(sync_status);
CREATE INDEX idx_xero_invoices_payment_id ON xero_invoices(payment_id);
CREATE INDEX idx_xero_invoices_tenant_id ON xero_invoices(tenant_id);
CREATE INDEX idx_xero_invoices_xero_invoice_id ON xero_invoices(xero_invoice_id);
CREATE INDEX idx_xero_invoices_sync_status ON xero_invoices(sync_status);
CREATE INDEX idx_xero_invoices_invoice_number ON xero_invoices(invoice_number);
CREATE INDEX idx_xero_invoice_line_items_xero_invoice_id ON xero_invoice_line_items(xero_invoice_id);
CREATE INDEX idx_xero_invoice_line_items_item_type ON xero_invoice_line_items(line_item_type);
CREATE INDEX idx_xero_payments_xero_invoice_id ON xero_payments(xero_invoice_id);
CREATE INDEX idx_xero_payments_tenant_id ON xero_payments(tenant_id);
CREATE INDEX idx_xero_payments_xero_payment_id ON xero_payments(xero_payment_id);
CREATE INDEX idx_xero_payments_sync_status ON xero_payments(sync_status);
CREATE INDEX idx_xero_sync_logs_tenant_id ON xero_sync_logs(tenant_id);
CREATE INDEX idx_xero_sync_logs_operation_type ON xero_sync_logs(operation_type);
CREATE INDEX idx_xero_sync_logs_status ON xero_sync_logs(status);
CREATE INDEX idx_xero_sync_logs_created_at ON xero_sync_logs(created_at);
CREATE INDEX idx_xero_sync_logs_entity_type_id ON xero_sync_logs(entity_type, entity_id);
CREATE INDEX idx_xero_webhooks_tenant_id ON xero_webhooks(tenant_id);
CREATE INDEX idx_xero_webhooks_event_category ON xero_webhooks(event_category);

-- Xero Integration Tables

-- Xero OAuth token storage
-- Stores OAuth tokens per organization (tenant) with refresh capability
CREATE TABLE xero_oauth_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id TEXT NOT NULL UNIQUE, -- Xero organization ID
    tenant_name TEXT NOT NULL, -- Organization name for admin display
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    id_token TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    scope TEXT NOT NULL,
    token_type TEXT NOT NULL DEFAULT 'Bearer',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Xero contact synchronization tracking
-- Tracks which users have been synced to Xero as contacts
CREATE TABLE xero_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES xero_oauth_tokens(tenant_id) ON DELETE CASCADE,
    xero_contact_id UUID NOT NULL, -- Xero's contact ID
    contact_number TEXT, -- Xero's contact number
    sync_status TEXT NOT NULL CHECK (sync_status IN ('pending', 'synced', 'failed', 'needs_update')),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    sync_error TEXT, -- Error message if sync failed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one contact per user per tenant
    UNIQUE(user_id, tenant_id)
);

-- Xero invoice synchronization tracking
-- Tracks which payments have been synced to Xero as invoices
CREATE TABLE xero_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES xero_oauth_tokens(tenant_id) ON DELETE CASCADE,
    xero_invoice_id UUID NOT NULL, -- Xero's invoice ID
    invoice_number TEXT NOT NULL, -- Xero's invoice number
    invoice_type TEXT NOT NULL DEFAULT 'ACCREC', -- ACCREC = Accounts Receivable
    invoice_status TEXT NOT NULL, -- DRAFT, AUTHORISED, PAID, etc.
    total_amount INTEGER NOT NULL, -- in cents, gross amount
    discount_amount INTEGER DEFAULT 0, -- in cents, total discounts
    net_amount INTEGER NOT NULL, -- in cents, amount after discounts
    stripe_fee_amount INTEGER DEFAULT 0, -- in cents, Stripe processing fees
    sync_status TEXT NOT NULL CHECK (sync_status IN ('pending', 'synced', 'failed', 'needs_update')),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    sync_error TEXT, -- Error message if sync failed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one invoice per payment per tenant
    UNIQUE(payment_id, tenant_id)
);

-- Xero invoice line items tracking
-- Tracks individual line items within invoices for detailed reconciliation
CREATE TABLE xero_invoice_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    xero_invoice_id UUID NOT NULL REFERENCES xero_invoices(id) ON DELETE CASCADE,
    line_item_type TEXT NOT NULL CHECK (line_item_type IN ('membership', 'registration', 'discount', 'donation')),
    item_id UUID, -- References membership_id, registration_id, discount_code_id, etc.
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_amount INTEGER NOT NULL, -- in cents (can be negative for discounts)
    account_code TEXT, -- Xero account code
    tax_type TEXT DEFAULT 'NONE',
    line_amount INTEGER NOT NULL, -- in cents, quantity * unit_amount
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Xero payment recording tracking
-- Tracks which Stripe payments have been recorded in Xero
CREATE TABLE xero_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    xero_invoice_id UUID NOT NULL REFERENCES xero_invoices(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES xero_oauth_tokens(tenant_id) ON DELETE CASCADE,
    xero_payment_id UUID NOT NULL, -- Xero's payment ID
    payment_method TEXT NOT NULL DEFAULT 'stripe',
    bank_account_code TEXT, -- Xero bank account code
    amount_paid INTEGER NOT NULL, -- in cents, net amount (after Stripe fees)
    stripe_fee_amount INTEGER DEFAULT 0, -- in cents, recorded as separate expense
    reference TEXT, -- Payment reference for reconciliation
    sync_status TEXT NOT NULL CHECK (sync_status IN ('pending', 'synced', 'failed')),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    sync_error TEXT, -- Error message if sync failed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one payment record per invoice per tenant
    UNIQUE(xero_invoice_id, tenant_id)
);

-- Xero synchronization error logs
-- Detailed error logging for debugging and monitoring
CREATE TABLE xero_sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id TEXT NOT NULL REFERENCES xero_oauth_tokens(tenant_id) ON DELETE CASCADE,
    operation_type TEXT NOT NULL CHECK (operation_type IN ('contact_sync', 'invoice_sync', 'payment_sync', 'token_refresh')),
    entity_type TEXT CHECK (entity_type IN ('user', 'payment', 'invoice', 'contact')),
    entity_id UUID, -- References user_id, payment_id, etc.
    xero_entity_id UUID, -- Xero's entity ID if applicable
    status TEXT NOT NULL CHECK (status IN ('success', 'error', 'warning')),
    error_code TEXT, -- Xero API error code
    error_message TEXT, -- Detailed error message
    request_data JSONB, -- Request payload for debugging
    response_data JSONB, -- Response data for debugging
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Xero webhook tracking (optional for future webhook support)
CREATE TABLE xero_webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id TEXT NOT NULL REFERENCES xero_oauth_tokens(tenant_id) ON DELETE CASCADE,
    webhook_id UUID NOT NULL, -- Xero's webhook ID
    webhook_key TEXT NOT NULL, -- Xero's webhook signing key
    event_category TEXT NOT NULL, -- INVOICE, CONTACT, etc.
    event_type TEXT NOT NULL, -- CREATE, UPDATE, DELETE
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one webhook per event type per tenant
    UNIQUE(tenant_id, event_category, event_type)
);

-- Add Xero tracking fields to existing tables
-- Add xero_synced flag to payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS xero_synced BOOLEAN DEFAULT FALSE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS xero_sync_error TEXT;

-- Add Xero tracking fields to user_memberships table
ALTER TABLE user_memberships ADD COLUMN IF NOT EXISTS xero_synced BOOLEAN DEFAULT FALSE;
ALTER TABLE user_memberships ADD COLUMN IF NOT EXISTS xero_sync_error TEXT;

-- Add Xero tracking fields to user_registrations table
ALTER TABLE user_registrations ADD COLUMN IF NOT EXISTS xero_synced BOOLEAN DEFAULT FALSE;
ALTER TABLE user_registrations ADD COLUMN IF NOT EXISTS xero_sync_error TEXT;

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE magic_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_pricing_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_code_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

-- Enable RLS for Xero tables
ALTER TABLE xero_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_webhooks ENABLE ROW LEVEL SECURITY;

-- Create basic RLS policies (users can see their own data, admins can see everything)

-- Users policies
CREATE POLICY "Users can view their own profile" ON users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON users
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can view all users" ON users
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- User memberships policies
CREATE POLICY "Users can view their own memberships" ON user_memberships
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own memberships" ON user_memberships
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own memberships" ON user_memberships
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all memberships" ON user_memberships
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Payments table policies
CREATE POLICY "Users can view their own payments" ON payments
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own payments" ON payments
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own payments" ON payments
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all payments" ON payments
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Payment items table policies  
CREATE POLICY "Users can view their own payment items" ON payment_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM payments 
            WHERE payments.id = payment_items.payment_id 
            AND payments.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert payment items for their payments" ON payment_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM payments 
            WHERE payments.id = payment_items.payment_id 
            AND payments.user_id = auth.uid()
        )
    );

CREATE POLICY "Admins can view all payment items" ON payment_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- User registrations policies
CREATE POLICY "Users can view their own registrations" ON user_registrations
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own registrations" ON user_registrations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all registrations" ON user_registrations
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Public policy for counting paid registrations (for capacity display)
-- Updated to be more explicit about allowing authenticated users to see paid registrations
CREATE POLICY "Anyone can count paid registrations" ON user_registrations
    FOR SELECT USING (
        payment_status = 'paid' 
        AND auth.role() = 'authenticated'
    );

-- Public read access for seasons, memberships, registrations
CREATE POLICY "Anyone can view seasons" ON seasons FOR SELECT USING (TRUE);
CREATE POLICY "Anyone can view memberships" ON memberships FOR SELECT USING (TRUE);
CREATE POLICY "Anyone can view registrations" ON registrations FOR SELECT USING (TRUE);
CREATE POLICY "Anyone can view categories" ON categories FOR SELECT USING (TRUE);
CREATE POLICY "Anyone can view registration categories" ON registration_categories FOR SELECT USING (TRUE);
CREATE POLICY "Anyone can view registration pricing tiers" ON registration_pricing_tiers FOR SELECT USING (TRUE);

-- Admin-only write access for core data
CREATE POLICY "Only admins can modify seasons" ON seasons
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

CREATE POLICY "Only admins can modify memberships" ON memberships
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

CREATE POLICY "Only admins can modify registrations" ON registrations
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

CREATE POLICY "Only admins can create user categories" ON categories 
FOR INSERT WITH CHECK (
    category_type = 'user' AND 
    EXISTS (
        SELECT 1 FROM users 
        WHERE id = auth.uid() AND is_admin = TRUE
    )
);

CREATE POLICY "Only admins can modify their user categories" ON categories 
FOR UPDATE USING (
    category_type = 'user' AND 
    created_by = auth.uid() AND
    EXISTS (
        SELECT 1 FROM users 
        WHERE id = auth.uid() AND is_admin = TRUE
    )
);

CREATE POLICY "Only admins can modify registration categories" ON registration_categories
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Functions to automatically update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger for users table
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- NOTE: Registration count trigger and function removed
-- Count is now calculated dynamically to avoid consistency issues

-- Performance indexes for membership model
CREATE INDEX idx_user_memberships_validity ON user_memberships(user_id, valid_from, valid_until);
CREATE INDEX idx_user_memberships_membership_type ON user_memberships(membership_id);

-- Performance indexes for discount system
CREATE INDEX idx_discount_codes_category_id ON discount_codes(discount_category_id);
CREATE INDEX idx_discount_usage_category_season ON discount_usage(user_id, discount_category_id, season_id);
CREATE INDEX idx_discount_usage_registration ON discount_usage(registration_id);

-- Email logs policies
CREATE POLICY "Users can view their own email logs" ON email_logs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can insert email logs" ON email_logs
    FOR INSERT WITH CHECK (true);

CREATE POLICY "System can update email logs" ON email_logs
    FOR UPDATE USING (true);

CREATE POLICY "Admins can view all email logs" ON email_logs
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Waitlist policies
CREATE POLICY "Users can view their own waitlist entries" ON waitlists
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can join waitlists" ON waitlists
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own waitlist entries" ON waitlists
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all waitlist entries" ON waitlists
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.is_admin = true
        )
    );

CREATE POLICY "Admins can manage all waitlist entries" ON waitlists
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.is_admin = true
        )
    );

CREATE POLICY "Admins can delete waitlist entries" ON waitlists
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.is_admin = true
        )
    );

-- Admin-only policies for sensitive tables

-- Registration Pricing Tiers: Admin-only management
CREATE POLICY "registration_pricing_tiers_admin_only" ON registration_pricing_tiers
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Discount Categories: Admin-only management (organizational groupings with accounting codes)
CREATE POLICY "discount_categories_admin_only" ON discount_categories
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Discount Codes: Admin-only management (sensitive pricing information)
CREATE POLICY "discount_codes_admin_only" ON discount_codes
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Allow authenticated users to read active discount codes for validation during checkout
CREATE POLICY "Users can read active discount codes for validation"
ON discount_codes
FOR SELECT
TO authenticated
USING (is_active = true);

-- Allow authenticated users to read active discount categories for validation
CREATE POLICY "Users can read active discount categories for validation"
ON discount_categories
FOR SELECT  
TO authenticated
USING (is_active = true);

-- Access Codes: Admin-only management (security-sensitive bypass codes)
CREATE POLICY "access_codes_admin_only" ON access_codes
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Payment Configurations: Admin-only management (critical payment system settings)
CREATE POLICY "payment_configurations_admin_only" ON payment_configurations
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- System Accounting Codes: Readable by all authenticated users, admin-only modifications
ALTER TABLE system_accounting_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read system accounting codes" 
ON system_accounting_codes FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Allow admins to update system accounting codes" 
ON system_accounting_codes FOR UPDATE 
TO authenticated 
USING (
    EXISTS (
        SELECT 1 FROM users 
        WHERE users.id = auth.uid() 
        AND users.is_admin = true
    )
);

CREATE POLICY "Allow admins to insert system accounting codes" 
ON system_accounting_codes FOR INSERT 
TO authenticated 
WITH CHECK (
    EXISTS (
        SELECT 1 FROM users 
        WHERE users.id = auth.uid() 
        AND users.is_admin = true
    )
);

-- Xero Integration RLS Policies (Admin only access)
-- Xero OAuth tokens - admin only
CREATE POLICY "xero_oauth_tokens_admin_only" ON xero_oauth_tokens
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Xero contacts - admin only
CREATE POLICY "xero_contacts_admin_only" ON xero_contacts
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Xero invoices - admin only
CREATE POLICY "xero_invoices_admin_only" ON xero_invoices
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Xero invoice line items - admin only
CREATE POLICY "xero_invoice_line_items_admin_only" ON xero_invoice_line_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Xero payments - admin only
CREATE POLICY "xero_payments_admin_only" ON xero_payments
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Xero sync logs - admin only
CREATE POLICY "xero_sync_logs_admin_only" ON xero_sync_logs
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Xero webhooks - admin only
CREATE POLICY "xero_webhooks_admin_only" ON xero_webhooks
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Create a function to automatically update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at columns on Xero tables
CREATE TRIGGER update_xero_oauth_tokens_updated_at BEFORE UPDATE ON xero_oauth_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_xero_contacts_updated_at BEFORE UPDATE ON xero_contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_xero_invoices_updated_at BEFORE UPDATE ON xero_invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_xero_payments_updated_at BEFORE UPDATE ON xero_payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

