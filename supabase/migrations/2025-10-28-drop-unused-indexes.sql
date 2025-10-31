-- Migration: Drop unused indexes
-- Date: 2025-10-28
-- Purpose: Remove unused indexes identified by Supabase performance advisor
--
-- Background:
-- The Supabase linter identified 45 indexes that have never been used in production.
-- These indexes are wasting storage space and slowing down INSERT/UPDATE/DELETE operations
-- with no query performance benefit.
--
-- Impact:
-- - Reduces storage overhead (45 indexes removed)
-- - Improves write performance (INSERT/UPDATE/DELETE)
-- - No functional impact since production data shows these indexes are never used
--
-- Source: Production database performance advisor analysis (62 INFO level warnings)

-- Users table (7 unused indexes)
DROP INDEX IF EXISTS idx_users_member_id;
DROP INDEX IF EXISTS idx_users_is_lgbtq;
DROP INDEX IF EXISTS idx_users_is_goalie;
DROP INDEX IF EXISTS idx_users_stripe_setup_intent_id;
DROP INDEX IF EXISTS idx_users_stripe_customer_id;

-- Login & Auth tables (6 unused indexes)
DROP INDEX IF EXISTS idx_login_attempts_user_id_time;
DROP INDEX IF EXISTS idx_login_attempts_email_time;
DROP INDEX IF EXISTS idx_login_attempts_ip_time;
DROP INDEX IF EXISTS idx_magic_link_tokens_token;
DROP INDEX IF EXISTS idx_magic_link_tokens_email_expires;

-- Registration related tables (11 unused indexes)
DROP INDEX IF EXISTS idx_categories_created_by;
DROP INDEX IF EXISTS idx_registration_categories_category;
DROP INDEX IF EXISTS idx_registration_categories_membership;
DROP INDEX IF EXISTS idx_registration_pricing_tiers_reg_starts;
DROP INDEX IF EXISTS idx_registrations_allow_alternates;
DROP INDEX IF EXISTS idx_registrations_updated_by;
DROP INDEX IF EXISTS idx_registration_captains_user_id;

-- Access codes and discounts (4 unused indexes)
DROP INDEX IF EXISTS idx_access_codes_code_type_active;
DROP INDEX IF EXISTS idx_discount_usage_user_season;
DROP INDEX IF EXISTS idx_discount_usage_code_time;

-- Alternates system (3 unused indexes)
DROP INDEX IF EXISTS idx_alternate_registrations_created_by;
DROP INDEX IF EXISTS idx_alternate_registrations_game_date;
DROP INDEX IF EXISTS idx_alternate_selections_selected_by;

-- Payments and refunds (4 unused indexes)
DROP INDEX IF EXISTS idx_refunds_stripe_payment_intent_id;
DROP INDEX IF EXISTS idx_refunds_stripe_charge_id;
DROP INDEX IF EXISTS idx_reports_data_payment_status;
DROP INDEX IF EXISTS idx_payments_stripe_charge_id;

-- Memberships (3 unused indexes)
DROP INDEX IF EXISTS idx_user_memberships_membership_type;
DROP INDEX IF EXISTS idx_user_memberships_payment_validity;
DROP INDEX IF EXISTS idx_user_memberships_xero_invoice_id;

-- Xero integration tables (9 unused indexes)
DROP INDEX IF EXISTS idx_xero_sync_logs_operation_type;
DROP INDEX IF EXISTS idx_xero_oauth_tokens_expires_at;
DROP INDEX IF EXISTS idx_xero_contacts_xero_contact_id;
DROP INDEX IF EXISTS idx_xero_contacts_sync_status;
DROP INDEX IF EXISTS idx_xero_invoice_line_items_item_type;
DROP INDEX IF EXISTS idx_xero_webhooks_event_category;
DROP INDEX IF EXISTS idx_reports_data_invoice_status;
DROP INDEX IF EXISTS idx_xero_invoices_abandoned;
DROP INDEX IF EXISTS idx_xero_payments_abandoned;

-- Xero accounts (2 unused indexes)
DROP INDEX IF EXISTS idx_xero_accounts_type;
DROP INDEX IF EXISTS idx_xero_accounts_name;

-- System events (3 unused indexes)
DROP INDEX IF EXISTS idx_system_events_status;
DROP INDEX IF EXISTS idx_system_events_initiator;
DROP INDEX IF EXISTS idx_system_events_started_at;

-- Waitlists (1 unused index)
DROP INDEX IF EXISTS idx_waitlists_discount_code_id;

-- Total: 45 unused indexes dropped
