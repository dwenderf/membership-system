-- Xero Integration Schema Migration
-- This migration adds tables for Xero OAuth tokens, contact sync, invoice sync, and error tracking

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

-- Index for efficient token lookup
CREATE INDEX idx_xero_oauth_tokens_tenant_id ON xero_oauth_tokens(tenant_id);
CREATE INDEX idx_xero_oauth_tokens_expires_at ON xero_oauth_tokens(expires_at);

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

-- Indexes for efficient contact lookup
CREATE INDEX idx_xero_contacts_user_id ON xero_contacts(user_id);
CREATE INDEX idx_xero_contacts_tenant_id ON xero_contacts(tenant_id);
CREATE INDEX idx_xero_contacts_xero_contact_id ON xero_contacts(xero_contact_id);
CREATE INDEX idx_xero_contacts_sync_status ON xero_contacts(sync_status);

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

-- Indexes for efficient invoice lookup
CREATE INDEX idx_xero_invoices_payment_id ON xero_invoices(payment_id);
CREATE INDEX idx_xero_invoices_tenant_id ON xero_invoices(tenant_id);
CREATE INDEX idx_xero_invoices_xero_invoice_id ON xero_invoices(xero_invoice_id);
CREATE INDEX idx_xero_invoices_sync_status ON xero_invoices(sync_status);
CREATE INDEX idx_xero_invoices_invoice_number ON xero_invoices(invoice_number);

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

-- Index for efficient line item lookup
CREATE INDEX idx_xero_invoice_line_items_xero_invoice_id ON xero_invoice_line_items(xero_invoice_id);
CREATE INDEX idx_xero_invoice_line_items_item_type ON xero_invoice_line_items(line_item_type);

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

-- Indexes for efficient payment lookup
CREATE INDEX idx_xero_payments_xero_invoice_id ON xero_payments(xero_invoice_id);
CREATE INDEX idx_xero_payments_tenant_id ON xero_payments(tenant_id);
CREATE INDEX idx_xero_payments_xero_payment_id ON xero_payments(xero_payment_id);
CREATE INDEX idx_xero_payments_sync_status ON xero_payments(sync_status);

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

-- Indexes for efficient log lookup and monitoring
CREATE INDEX idx_xero_sync_logs_tenant_id ON xero_sync_logs(tenant_id);
CREATE INDEX idx_xero_sync_logs_operation_type ON xero_sync_logs(operation_type);
CREATE INDEX idx_xero_sync_logs_status ON xero_sync_logs(status);
CREATE INDEX idx_xero_sync_logs_created_at ON xero_sync_logs(created_at);
CREATE INDEX idx_xero_sync_logs_entity_type_id ON xero_sync_logs(entity_type, entity_id);

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

-- Index for efficient webhook lookup
CREATE INDEX idx_xero_webhooks_tenant_id ON xero_webhooks(tenant_id);
CREATE INDEX idx_xero_webhooks_event_category ON xero_webhooks(event_category);

-- Add Xero tracking fields to existing tables
-- Add xero_synced flag to payments table
ALTER TABLE payments ADD COLUMN xero_synced BOOLEAN DEFAULT FALSE;
ALTER TABLE payments ADD COLUMN xero_sync_error TEXT;

-- Add Xero tracking fields to user_memberships table
ALTER TABLE user_memberships ADD COLUMN xero_synced BOOLEAN DEFAULT FALSE;
ALTER TABLE user_memberships ADD COLUMN xero_sync_error TEXT;

-- Add Xero tracking fields to user_registrations table
ALTER TABLE user_registrations ADD COLUMN xero_synced BOOLEAN DEFAULT FALSE;
ALTER TABLE user_registrations ADD COLUMN xero_sync_error TEXT;

-- Create indexes for efficient sync status queries
CREATE INDEX idx_payments_xero_synced ON payments(xero_synced);
CREATE INDEX idx_user_memberships_xero_synced ON user_memberships(xero_synced);
CREATE INDEX idx_user_registrations_xero_synced ON user_registrations(xero_synced);

-- Create a function to automatically update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at columns
CREATE TRIGGER update_xero_oauth_tokens_updated_at BEFORE UPDATE ON xero_oauth_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_xero_contacts_updated_at BEFORE UPDATE ON xero_contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_xero_invoices_updated_at BEFORE UPDATE ON xero_invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_xero_payments_updated_at BEFORE UPDATE ON xero_payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE xero_oauth_tokens IS 'Stores OAuth tokens for Xero API access, supports multiple organizations';
COMMENT ON TABLE xero_contacts IS 'Tracks synchronization of users as contacts in Xero';
COMMENT ON TABLE xero_invoices IS 'Tracks synchronization of payments as invoices in Xero';
COMMENT ON TABLE xero_invoice_line_items IS 'Detailed line items for each Xero invoice';
COMMENT ON TABLE xero_payments IS 'Tracks recording of Stripe payments in Xero with fee handling';
COMMENT ON TABLE xero_sync_logs IS 'Detailed error and success logging for all Xero operations';
COMMENT ON TABLE xero_webhooks IS 'Future webhook configuration for real-time Xero synchronization';

-- Grant necessary permissions (will be handled by RLS policies)
-- Note: RLS policies will be added after testing the basic integration