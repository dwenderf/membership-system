-- Fix accounting codes for discounts
-- Add donation_given_default and rename donation_default to donation_received_default

-- Update existing donation_default to donation_received_default
UPDATE system_accounting_codes 
SET 
    code_type = 'donation_received_default',
    description = 'Default accounting code for donations received (line items in invoices)'
WHERE code_type = 'donation_default';

-- Add new donation_given_default for financial assistance/discounts (with empty accounting_code)
INSERT INTO system_accounting_codes (code_type, accounting_code, description) VALUES
('donation_given_default', '', 'Default accounting code for financial assistance/discounts given');