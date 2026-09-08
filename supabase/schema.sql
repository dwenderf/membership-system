-- =============================================================================
-- GENERATED FILE -- DO NOT EDIT
-- =============================================================================
--
-- Built from supabase/migrations/ by scripts/build-schema-sql.js.
-- Run `npm run schema:build` after adding a migration.
--
-- Apply this file to bootstrap a fresh Supabase project; apply individual
-- migrations to update an existing one.
--
-- Source files, in order:
--   20260907000000_baseline_schema.sql
--   20260907000001_reconcile_dev_to_baseline.sql
--   20260907000002_revoke_public_function_access.sql
--   20260908154524_cleanup_remaining_function_advisor_findings.sql
-- =============================================================================

-- >>> 20260907000000_baseline_schema.sql >>>

-- =============================================================================
-- Baseline schema
-- =============================================================================
--
-- Generated from the live production database (membership-system-prod) on
-- 2026-09-07. This file replaces the 140 dated migration files that preceded it
-- (2025-01-27 .. 2026-09-07); their history is preserved in git, and every
-- change they made is folded into the definitions below.
--
-- This is the single source of truth for the schema. `supabase/schema.sql` is a
-- generated artifact built from this directory (`npm run schema:build`) -- do
-- not edit it by hand.
--
-- Applying this to a fresh Supabase project reproduces production's `public`
-- schema: tables, constraints, indexes, functions, triggers, views, RLS
-- policies and comments. Everything is written to be safely re-runnable.
--
-- Not included (Supabase manages these): the `auth`, `storage` and `vault`
-- schemas, and the default `anon`/`authenticated`/`service_role` grants that
-- Supabase's default privileges apply to objects created in `public`. Access
-- control here is RLS, not grants.
--
-- Migrations are applied manually by the maintainer -- see AGENTS.md.
-- =============================================================================


-- =============================================================================
-- EXTENSIONS
-- =============================================================================
-- Supabase installs these into the `extensions` schema, which is on the default
-- search_path, so functions below can call uuid_generate_v4() unqualified.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


-- =============================================================================
-- SEQUENCES
-- =============================================================================
-- Human-facing member numbers, starting at 1000. Assigned by the
-- set_member_id_trigger on users.

CREATE SEQUENCE IF NOT EXISTS public.member_id_seq START WITH 1000 INCREMENT BY 1;


-- =============================================================================
-- TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    phone text,
    is_admin boolean DEFAULT false,
    tags text[] DEFAULT '{}'::text[],
    is_lgbtq boolean,
    is_goalie boolean DEFAULT false NOT NULL,
    member_id integer,
    onboarding_completed_at timestamp with time zone,
    terms_accepted_at timestamp with time zone,
    terms_version text,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    stripe_setup_intent_id text,
    stripe_payment_method_id text,
    setup_intent_status text,
    payment_method_updated_at timestamp with time zone,
    stripe_customer_id text,
    payment_plan_enabled boolean DEFAULT false,
    preferences jsonb,
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_member_id_key UNIQUE (member_id),
    CONSTRAINT users_setup_intent_status_check CHECK ((setup_intent_status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text])))
);

CREATE TABLE IF NOT EXISTS public.seasons (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT seasons_pkey PRIMARY KEY (id),
    CONSTRAINT seasons_type_check CHECK ((type = ANY (ARRAY['fall_winter'::text, 'spring_summer'::text])))
);

CREATE TABLE IF NOT EXISTS public.memberships (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    description text,
    price_monthly integer NOT NULL,
    price_annual integer NOT NULL,
    accounting_code text,
    allow_discounts boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    allow_monthly boolean DEFAULT true,
    CONSTRAINT memberships_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.categories (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    description text,
    category_type text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    is_goalie_only boolean DEFAULT false NOT NULL,
    CONSTRAINT categories_pkey PRIMARY KEY (id),
    CONSTRAINT categories_name_category_type_key UNIQUE (name, category_type),
    CONSTRAINT categories_category_type_check CHECK ((category_type = ANY (ARRAY['system'::text, 'user'::text])))
);

CREATE TABLE IF NOT EXISTS public.registrations (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    season_id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    allow_discounts boolean DEFAULT true,
    is_active boolean DEFAULT false,
    presale_start_at timestamp with time zone,
    regular_start_at timestamp with time zone,
    registration_end_at timestamp with time zone,
    presale_code text,
    allow_lgbtq_presale boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    allow_alternates boolean DEFAULT false,
    alternate_price integer,
    alternate_accounting_code text,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid,
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    survey_id text,
    require_survey boolean DEFAULT false,
    required_membership_id uuid,
    published_at timestamp with time zone,
    CONSTRAINT registrations_pkey PRIMARY KEY (id),
    CONSTRAINT check_event_date_order CHECK ((((start_date IS NULL) AND (end_date IS NULL)) OR ((start_date IS NOT NULL) AND (end_date IS NOT NULL) AND (end_date >= start_date)))),
    CONSTRAINT registrations_type_check CHECK ((type = ANY (ARRAY['team'::text, 'scrimmage'::text, 'event'::text, 'tournament'::text])))
);

CREATE TABLE IF NOT EXISTS public.registration_categories (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    registration_id uuid NOT NULL,
    category_id uuid,
    custom_name text,
    price integer NOT NULL,
    max_capacity integer,
    accounting_code text,
    required_membership_id uuid,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT registration_categories_pkey PRIMARY KEY (id),
    CONSTRAINT registration_categories_registration_id_category_id_key UNIQUE (registration_id, category_id),
    CONSTRAINT registration_categories_registration_id_custom_name_key UNIQUE (registration_id, custom_name),
    CONSTRAINT check_category_or_custom CHECK ((((category_id IS NOT NULL) AND (custom_name IS NULL)) OR ((category_id IS NULL) AND (custom_name IS NOT NULL))))
);

CREATE TABLE IF NOT EXISTS public.registration_pricing_tiers (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    registration_id uuid NOT NULL,
    registration_category_id uuid,
    tier_name text NOT NULL,
    price integer NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    requires_code boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT registration_pricing_tiers_pkey PRIMARY KEY (id),
    CONSTRAINT registration_pricing_tiers_registration_id_tier_name_key UNIQUE (registration_id, tier_name)
);

CREATE TABLE IF NOT EXISTS public.registration_captains (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    registration_id uuid NOT NULL,
    user_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now(),
    assigned_by uuid NOT NULL,
    CONSTRAINT registration_captains_pkey PRIMARY KEY (id),
    CONSTRAINT registration_captains_registration_id_user_id_key UNIQUE (registration_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.payments (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    total_amount integer NOT NULL,
    discount_amount integer DEFAULT 0,
    final_amount integer NOT NULL,
    stripe_payment_intent_id text,
    status text NOT NULL,
    payment_method text DEFAULT 'stripe'::text,
    refund_reason text,
    refunded_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    stripe_fee_amount integer DEFAULT 0,
    stripe_charge_id text,
    CONSTRAINT payments_pkey PRIMARY KEY (id),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'refunded'::text, 'cancelled'::text])))
);

CREATE TABLE IF NOT EXISTS public.refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount numeric(10,2) NOT NULL,
    reason text,
    stripe_refund_id text,
    xero_credit_note_id text,
    status text NOT NULL,
    processed_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    stripe_payment_intent_id text,
    stripe_charge_id text,
    CONSTRAINT refunds_pkey PRIMARY KEY (id),
    CONSTRAINT refunds_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT refunds_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
);

CREATE TABLE IF NOT EXISTS public.payment_configurations (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    provider text NOT NULL,
    is_active boolean DEFAULT false,
    is_primary boolean DEFAULT false,
    configuration jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT payment_configurations_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.user_memberships (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    payment_id uuid,
    valid_from date NOT NULL,
    valid_until date NOT NULL,
    months_purchased integer,
    payment_status text NOT NULL,
    stripe_payment_intent_id text,
    amount_paid integer,
    purchased_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    xero_invoice_id uuid,
    CONSTRAINT user_memberships_pkey PRIMARY KEY (id),
    CONSTRAINT unique_stripe_payment_intent_id UNIQUE (stripe_payment_intent_id),
    CONSTRAINT chk_membership_validity CHECK ((valid_until > valid_from)),
    CONSTRAINT user_memberships_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'refunded'::text])))
);

CREATE TABLE IF NOT EXISTS public.user_registrations (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    registration_id uuid NOT NULL,
    registration_category_id uuid,
    user_membership_id uuid,
    payment_id uuid,
    payment_status text NOT NULL,
    registration_fee integer,
    amount_paid integer,
    presale_code_used text,
    stripe_payment_intent_id text,
    reservation_expires_at timestamp with time zone,
    registered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    xero_invoice_id uuid,
    updated_at timestamp with time zone DEFAULT now(),
    refunded_at timestamp with time zone,
    CONSTRAINT user_registrations_pkey PRIMARY KEY (id),
    CONSTRAINT user_registrations_payment_status_check CHECK ((payment_status = ANY (ARRAY['awaiting_payment'::text, 'processing'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'expired'::text])))
);

CREATE TABLE IF NOT EXISTS public.waitlists (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    registration_id uuid NOT NULL,
    registration_category_id uuid,
    position integer NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    removed_at timestamp with time zone,
    discount_code_id uuid,
    selected_by_admin_id uuid,
    CONSTRAINT waitlists_pkey PRIMARY KEY (id),
    CONSTRAINT waitlists_user_id_registration_id_registration_category_id_key UNIQUE (user_id, registration_id, registration_category_id)
);

CREATE TABLE IF NOT EXISTS public.alternate_registrations (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    registration_id uuid NOT NULL,
    game_description text NOT NULL,
    game_date timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    game_end_time timestamp with time zone NOT NULL,
    CONSTRAINT alternate_registrations_pkey PRIMARY KEY (id),
    CONSTRAINT check_game_time_order CHECK ((game_end_time >= game_date))
);

CREATE TABLE IF NOT EXISTS public.alternate_selections (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    alternate_registration_id uuid NOT NULL,
    user_id uuid NOT NULL,
    discount_code_id uuid,
    payment_id uuid,
    amount_charged integer NOT NULL,
    selected_by uuid NOT NULL,
    selected_at timestamp with time zone DEFAULT now(),
    CONSTRAINT alternate_selections_pkey PRIMARY KEY (id),
    CONSTRAINT alternate_selections_alternate_registration_id_user_id_key UNIQUE (alternate_registration_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.user_alternate_registrations (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    registration_id uuid NOT NULL,
    discount_code_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_alternate_registrations_pkey PRIMARY KEY (id),
    CONSTRAINT user_alternate_registrations_user_id_registration_id_key UNIQUE (user_id, registration_id)
);

CREATE TABLE IF NOT EXISTS public.discount_categories (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    accounting_code text NOT NULL,
    max_discount_per_user_per_season integer,
    is_active boolean DEFAULT true,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    requires_user_allowance boolean DEFAULT false NOT NULL,
    default_percentage numeric(5,2),
    priority integer DEFAULT 0 NOT NULL,
    CONSTRAINT discount_categories_pkey PRIMARY KEY (id),
    CONSTRAINT uq_discount_categories_accounting_code UNIQUE (accounting_code),
    CONSTRAINT uq_discount_categories_name UNIQUE (name),
    CONSTRAINT chk_max_discount_positive CHECK (((max_discount_per_user_per_season IS NULL) OR (max_discount_per_user_per_season > 0))),
    CONSTRAINT discount_categories_default_percentage_check CHECK (((default_percentage IS NULL) OR ((default_percentage > (0)::numeric) AND (default_percentage <= (100)::numeric))))
);

CREATE TABLE IF NOT EXISTS public.discount_codes (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    discount_category_id uuid NOT NULL,
    code text NOT NULL,
    percentage numeric(5,2),
    is_active boolean DEFAULT true,
    valid_from timestamp with time zone,
    valid_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    uses_user_allowance boolean DEFAULT false NOT NULL,
    CONSTRAINT discount_codes_pkey PRIMARY KEY (id),
    CONSTRAINT discount_codes_code_key UNIQUE (code),
    CONSTRAINT chk_discount_codes_percentage_or_allowance CHECK (((percentage IS NOT NULL) OR uses_user_allowance))
);

CREATE TABLE IF NOT EXISTS public.discount_usage (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    discount_code_id uuid NOT NULL,
    discount_category_id uuid NOT NULL,
    season_id uuid NOT NULL,
    amount_saved integer NOT NULL,
    used_at timestamp with time zone DEFAULT now() NOT NULL,
    registration_id uuid,
    CONSTRAINT discount_usage_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.user_discount_allowances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    discount_category_id uuid NOT NULL,
    season_id uuid NOT NULL,
    discount_percentage numeric(5,2),
    max_discount_amount integer,
    is_default boolean DEFAULT false NOT NULL,
    notes text,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_discount_allowances_pkey PRIMARY KEY (id),
    CONSTRAINT uq_user_discount_allowance_user_cat_season UNIQUE (user_id, discount_category_id, season_id),
    CONSTRAINT user_discount_allowances_discount_percentage_check CHECK (((discount_percentage IS NULL) OR ((discount_percentage > (0)::numeric) AND (discount_percentage <= (100)::numeric)))),
    CONSTRAINT user_discount_allowances_max_discount_amount_check CHECK (((max_discount_amount IS NULL) OR (max_discount_amount >= 0)))
);

CREATE TABLE IF NOT EXISTS public.access_codes (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    code text NOT NULL,
    type text NOT NULL,
    registration_id uuid,
    generated_by uuid NOT NULL,
    is_single_use boolean NOT NULL,
    expires_at timestamp with time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT access_codes_pkey PRIMARY KEY (id),
    CONSTRAINT access_codes_code_key UNIQUE (code),
    CONSTRAINT access_codes_type_check CHECK ((type = ANY (ARRAY['pre_sale'::text, 'waitlist_bypass'::text])))
);

CREATE TABLE IF NOT EXISTS public.access_code_usage (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    access_code_id uuid NOT NULL,
    user_id uuid NOT NULL,
    registration_id uuid NOT NULL,
    used_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT access_code_usage_pkey PRIMARY KEY (id),
    CONSTRAINT access_code_usage_access_code_id_user_id_registration_id_key UNIQUE (access_code_id, user_id, registration_id)
);

CREATE TABLE IF NOT EXISTS public.user_survey_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    survey_id text NOT NULL,
    response_data jsonb NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_survey_responses_pkey PRIMARY KEY (id),
    CONSTRAINT user_survey_responses_user_id_survey_id_key UNIQUE (user_id, survey_id)
);

CREATE TABLE IF NOT EXISTS public.email_logs (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    email_address text NOT NULL,
    event_type text NOT NULL,
    subject text NOT NULL,
    template_id text,
    loops_event_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    opened_at timestamp with time zone,
    first_clicked_at timestamp with time zone,
    bounced_at timestamp with time zone,
    bounce_reason text,
    email_data jsonb,
    triggered_by text,
    triggered_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT email_logs_pkey PRIMARY KEY (id),
    CONSTRAINT email_logs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'delivered'::text, 'bounced'::text, 'spam'::text, 'failed'::text]))),
    CONSTRAINT email_logs_triggered_by_check CHECK ((triggered_by = ANY (ARRAY['user_action'::text, 'admin_send'::text, 'automated'::text])))
);

CREATE TABLE IF NOT EXISTS public.email_change_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    old_email text NOT NULL,
    new_email text,
    event_type text NOT NULL,
    metadata jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT email_change_logs_pkey PRIMARY KEY (id),
    CONSTRAINT email_change_logs_event_type_check CHECK ((event_type = ANY (ARRAY['request_created'::text, 'request_failed'::text, 'request_duplicate_email'::text, 'verification_sent'::text, 'email_updated'::text, 'email_update_failed'::text, 'xero_sync_succeeded'::text, 'xero_sync_failed'::text, 'rate_limit_hit'::text])))
);

CREATE TABLE IF NOT EXISTS public.login_attempts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid,
    email text NOT NULL,
    method text NOT NULL,
    ip_address inet NOT NULL,
    user_agent text,
    success boolean NOT NULL,
    failure_reason text,
    attempted_at timestamp with time zone DEFAULT now(),
    CONSTRAINT login_attempts_pkey PRIMARY KEY (id),
    CONSTRAINT login_attempts_method_check CHECK ((method = ANY (ARRAY['magic_link'::text, 'google'::text, 'apple'::text])))
);

CREATE TABLE IF NOT EXISTS public.magic_link_tokens (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    email text NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    ip_address inet NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT magic_link_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT magic_link_tokens_token_key UNIQUE (token)
);

CREATE TABLE IF NOT EXISTS public.system_accounting_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code_type text NOT NULL,
    accounting_code text,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT system_accounting_codes_pkey PRIMARY KEY (id),
    CONSTRAINT unique_code_type UNIQUE (code_type)
);

CREATE TABLE IF NOT EXISTS public.system_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    status text NOT NULL,
    initiator text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    records_processed integer DEFAULT 0,
    records_successful integer DEFAULT 0,
    records_failed integer DEFAULT 0,
    error_message text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT system_events_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.xero_oauth_tokens (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id text NOT NULL,
    tenant_name text NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    id_token text,
    expires_at timestamp with time zone NOT NULL,
    scope text NOT NULL,
    token_type text DEFAULT 'Bearer'::text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT xero_oauth_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT xero_oauth_tokens_tenant_id_key UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS public.xero_accounts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id text NOT NULL,
    xero_account_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    status text NOT NULL,
    description text,
    last_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT xero_accounts_pkey PRIMARY KEY (id),
    CONSTRAINT unique_xero_account_per_tenant UNIQUE (tenant_id, xero_account_id),
    CONSTRAINT xero_accounts_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'ARCHIVED'::text])))
);

CREATE TABLE IF NOT EXISTS public.xero_contacts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    tenant_id text NOT NULL,
    xero_contact_id uuid NOT NULL,
    contact_number text,
    sync_status text NOT NULL,
    last_synced_at timestamp with time zone,
    sync_error text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT xero_contacts_pkey PRIMARY KEY (id),
    CONSTRAINT xero_contacts_user_id_tenant_id_key UNIQUE (user_id, tenant_id),
    CONSTRAINT xero_contacts_sync_status_check CHECK ((sync_status = ANY (ARRAY['pending'::text, 'synced'::text, 'failed'::text, 'needs_update'::text])))
);

CREATE TABLE IF NOT EXISTS public.xero_invoices (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    payment_id uuid,
    tenant_id text,
    xero_invoice_id uuid,
    invoice_number text,
    invoice_type text DEFAULT 'ACCREC'::text NOT NULL,
    invoice_status text DEFAULT 'DRAFT'::text NOT NULL,
    total_amount integer NOT NULL,
    discount_amount integer DEFAULT 0,
    net_amount integer NOT NULL,
    stripe_fee_amount integer DEFAULT 0,
    sync_status text NOT NULL,
    last_synced_at timestamp with time zone,
    sync_error text,
    staged_at timestamp with time zone,
    staging_metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_payment_plan boolean DEFAULT false,
    CONSTRAINT xero_invoices_pkey PRIMARY KEY (id),
    CONSTRAINT xero_invoices_payment_tenant_type_unique UNIQUE (payment_id, tenant_id, invoice_type),
    CONSTRAINT xero_invoices_sync_status_check CHECK ((sync_status = ANY (ARRAY['pending'::text, 'staged'::text, 'processing'::text, 'synced'::text, 'failed'::text, 'ignore'::text, 'abandoned'::text])))
);

CREATE TABLE IF NOT EXISTS public.xero_invoice_line_items (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    xero_invoice_id uuid NOT NULL,
    line_item_type text NOT NULL,
    item_id uuid,
    description text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_amount integer NOT NULL,
    account_code text,
    tax_type text DEFAULT 'NONE'::text,
    line_amount integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    discount_code_id uuid,
    CONSTRAINT xero_invoice_line_items_pkey PRIMARY KEY (id),
    CONSTRAINT xero_invoice_line_items_line_item_type_check CHECK ((line_item_type = ANY (ARRAY['membership'::text, 'registration'::text, 'discount'::text, 'donation'::text])))
);

CREATE TABLE IF NOT EXISTS public.xero_payments (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    xero_invoice_id uuid NOT NULL,
    tenant_id text,
    xero_payment_id uuid,
    payment_method text DEFAULT 'stripe'::text NOT NULL,
    bank_account_code text,
    amount_paid integer NOT NULL,
    stripe_fee_amount integer DEFAULT 0,
    reference text,
    sync_status text NOT NULL,
    last_synced_at timestamp with time zone,
    sync_error text,
    staged_at timestamp with time zone,
    staging_metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    payment_type text DEFAULT 'full'::text NOT NULL,
    installment_number integer,
    planned_payment_date date,
    attempt_count integer DEFAULT 0,
    last_attempt_at timestamp with time zone,
    failure_reason text,
    CONSTRAINT xero_payments_pkey PRIMARY KEY (id),
    CONSTRAINT xero_payments_payment_type_check CHECK ((payment_type = ANY (ARRAY['full'::text, 'installment'::text]))),
    CONSTRAINT xero_payments_sync_status_check CHECK ((sync_status = ANY (ARRAY['pending'::text, 'staged'::text, 'planned'::text, 'cancelled'::text, 'processing'::text, 'synced'::text, 'failed'::text, 'ignore'::text, 'abandoned'::text])))
);

CREATE TABLE IF NOT EXISTS public.xero_sync_logs (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id text NOT NULL,
    operation_type text NOT NULL,
    entity_type text,
    entity_id uuid,
    xero_entity_id uuid,
    status text NOT NULL,
    error_code text,
    error_message text,
    request_data jsonb,
    response_data jsonb,
    retry_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT xero_sync_logs_pkey PRIMARY KEY (id),
    CONSTRAINT xero_sync_logs_entity_type_check CHECK ((entity_type = ANY (ARRAY['user'::text, 'payment'::text, 'invoice'::text, 'contact'::text, 'credit_note'::text]))),
    CONSTRAINT xero_sync_logs_operation_type_check CHECK ((operation_type = ANY (ARRAY['contact_sync'::text, 'invoice_sync'::text, 'payment_sync'::text, 'token_refresh'::text, 'credit_note_sync'::text]))),
    CONSTRAINT xero_sync_logs_status_check CHECK ((status = ANY (ARRAY['success'::text, 'error'::text, 'warning'::text])))
);

CREATE TABLE IF NOT EXISTS public.xero_webhooks (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id text NOT NULL,
    webhook_id uuid NOT NULL,
    webhook_key text NOT NULL,
    event_category text NOT NULL,
    event_type text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT xero_webhooks_pkey PRIMARY KEY (id),
    CONSTRAINT xero_webhooks_tenant_id_event_category_event_type_key UNIQUE (tenant_id, event_category, event_type)
);


-- =============================================================================
-- FOREIGN KEYS
-- =============================================================================
-- Added after every table exists, so the file has no ordering constraints.
-- Each is skipped if already present, which keeps the file re-runnable.
--
-- Note on cardinality (see AGENTS.md): the FK column lives on the table listed
-- first, so `user_registrations.registration_id -> registrations(id)` means a
-- user_registration embeds exactly ONE registration, not an array.

DO $$
DECLARE
    fk record;
BEGIN
    FOR fk IN SELECT * FROM (VALUES
        ('access_code_usage', 'access_code_usage_access_code_id_fkey', 'FOREIGN KEY (access_code_id) REFERENCES public.access_codes(id) ON DELETE CASCADE'),
        ('access_code_usage', 'access_code_usage_registration_id_fkey', 'FOREIGN KEY (registration_id) REFERENCES public.registrations(id) ON DELETE CASCADE'),
        ('access_code_usage', 'access_code_usage_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE'),
        ('access_codes', 'access_codes_generated_by_fkey', 'FOREIGN KEY (generated_by) REFERENCES public.users(id)'),
        ('access_codes', 'access_codes_registration_id_fkey', 'FOREIGN KEY (registration_id) REFERENCES public.registrations(id)'),
        ('alternate_registrations', 'alternate_registrations_created_by_fkey', 'FOREIGN KEY (created_by) REFERENCES public.users(id)'),
        ('alternate_registrations', 'alternate_registrations_registration_id_fkey', 'FOREIGN KEY (registration_id) REFERENCES public.registrations(id) ON DELETE CASCADE'),
        ('alternate_selections', 'alternate_selections_alternate_registration_id_fkey', 'FOREIGN KEY (alternate_registration_id) REFERENCES public.alternate_registrations(id) ON DELETE CASCADE'),
        ('alternate_selections', 'alternate_selections_discount_code_id_fkey', 'FOREIGN KEY (discount_code_id) REFERENCES public.discount_codes(id)'),
        ('alternate_selections', 'alternate_selections_payment_id_fkey', 'FOREIGN KEY (payment_id) REFERENCES public.payments(id)'),
        ('alternate_selections', 'alternate_selections_selected_by_fkey', 'FOREIGN KEY (selected_by) REFERENCES public.users(id)'),
        ('alternate_selections', 'alternate_selections_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE'),
        ('categories', 'categories_created_by_fkey', 'FOREIGN KEY (created_by) REFERENCES public.users(id)'),
        ('discount_codes', 'discount_codes_discount_category_id_fkey', 'FOREIGN KEY (discount_category_id) REFERENCES public.discount_categories(id)'),
        ('discount_usage', 'discount_usage_discount_category_id_fkey', 'FOREIGN KEY (discount_category_id) REFERENCES public.discount_categories(id)'),
        ('discount_usage', 'discount_usage_discount_code_id_fkey', 'FOREIGN KEY (discount_code_id) REFERENCES public.discount_codes(id) ON DELETE CASCADE'),
        ('discount_usage', 'discount_usage_registration_id_fkey', 'FOREIGN KEY (registration_id) REFERENCES public.registrations(id)'),
        ('discount_usage', 'discount_usage_season_id_fkey', 'FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE'),
        ('discount_usage', 'discount_usage_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE'),
        ('email_change_logs', 'email_change_logs_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE'),
        ('email_logs', 'email_logs_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE'),
        ('login_attempts', 'login_attempts_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id)'),
        ('payments', 'payments_refunded_by_fkey', 'FOREIGN KEY (refunded_by) REFERENCES public.users(id)'),
        ('payments', 'payments_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE'),
        ('refunds', 'refunds_payment_id_fkey', 'FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE'),
        ('refunds', 'refunds_processed_by_fkey', 'FOREIGN KEY (processed_by) REFERENCES public.users(id)'),
        ('refunds', 'refunds_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE'),
        ('registration_captains', 'registration_captains_assigned_by_fkey', 'FOREIGN KEY (assigned_by) REFERENCES public.users(id)'),
        ('registration_captains', 'registration_captains_registration_id_fkey', 'FOREIGN KEY (registration_id) REFERENCES public.registrations(id) ON DELETE CASCADE'),
        ('registration_captains', 'registration_captains_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE'),
        ('registration_categories', 'registration_categories_category_id_fkey', 'FOREIGN KEY (category_id) REFERENCES public.categories(id)'),
        ('registration_categories', 'registration_categories_registration_id_fkey', 'FOREIGN KEY (registration_id) REFERENCES public.registrations(id) ON DELETE CASCADE'),
        ('registration_categories', 'registration_categories_required_membership_id_fkey', 'FOREIGN KEY (required_membership_id) REFERENCES public.memberships(id)'),
        ('registration_pricing_tiers', 'registration_pricing_tiers_registration_category_id_fkey', 'FOREIGN KEY (registration_category_id) REFERENCES public.registration_categories(id)'),
        ('registration_pricing_tiers', 'registration_pricing_tiers_registration_id_fkey', 'FOREIGN KEY (registration_id) REFERENCES public.registrations(id) ON DELETE CASCADE'),
        ('registrations', 'registrations_required_membership_id_fkey', 'FOREIGN KEY (required_membership_id) REFERENCES public.memberships(id)'),
        ('registrations', 'registrations_season_id_fkey', 'FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE'),
        ('registrations', 'registrations_updated_by_fkey', 'FOREIGN KEY (updated_by) REFERENCES public.users(id)'),
        ('user_alternate_registrations', 'user_alternate_registrations_discount_code_id_fkey', 'FOREIGN KEY (discount_code_id) REFERENCES public.discount_codes(id)'),
        ('user_alternate_registrations', 'user_alternate_registrations_registration_id_fkey', 'FOREIGN KEY (registration_id) REFERENCES public.registrations(id) ON DELETE CASCADE'),
        ('user_alternate_registrations', 'user_alternate_registrations_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE'),
        ('user_discount_allowances', 'user_discount_allowances_created_by_fkey', 'FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL'),
        ('user_discount_allowances', 'user_discount_allowances_discount_category_id_fkey', 'FOREIGN KEY (discount_category_id) REFERENCES public.discount_categories(id) ON DELETE CASCADE'),
        ('user_discount_allowances', 'user_discount_allowances_season_id_fkey', 'FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE'),
        ('user_discount_allowances', 'user_discount_allowances_updated_by_fkey', 'FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL'),
        ('user_discount_allowances', 'user_discount_allowances_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE'),
        ('user_memberships', 'user_memberships_membership_id_fkey', 'FOREIGN KEY (membership_id) REFERENCES public.memberships(id) ON DELETE CASCADE'),
        ('user_memberships', 'user_memberships_payment_id_fkey', 'FOREIGN KEY (payment_id) REFERENCES public.payments(id)'),
        ('user_memberships', 'user_memberships_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE'),
        ('user_memberships', 'user_memberships_xero_invoice_id_fkey', 'FOREIGN KEY (xero_invoice_id) REFERENCES public.xero_invoices(id)'),
        ('user_registrations', 'user_registrations_payment_id_fkey', 'FOREIGN KEY (payment_id) REFERENCES public.payments(id)'),
        ('user_registrations', 'user_registrations_registration_category_id_fkey', 'FOREIGN KEY (registration_category_id) REFERENCES public.registration_categories(id)'),
        ('user_registrations', 'user_registrations_registration_id_fkey', 'FOREIGN KEY (registration_id) REFERENCES public.registrations(id) ON DELETE CASCADE'),
        ('user_registrations', 'user_registrations_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE'),
        ('user_registrations', 'user_registrations_user_membership_id_fkey', 'FOREIGN KEY (user_membership_id) REFERENCES public.user_memberships(id)'),
        ('user_registrations', 'user_registrations_xero_invoice_id_fkey', 'FOREIGN KEY (xero_invoice_id) REFERENCES public.xero_invoices(id)'),
        ('user_survey_responses', 'user_survey_responses_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE'),
        ('waitlists', 'waitlists_discount_code_id_fkey', 'FOREIGN KEY (discount_code_id) REFERENCES public.discount_codes(id)'),
        ('waitlists', 'waitlists_registration_category_id_fkey', 'FOREIGN KEY (registration_category_id) REFERENCES public.registration_categories(id) ON DELETE CASCADE'),
        ('waitlists', 'waitlists_registration_id_fkey', 'FOREIGN KEY (registration_id) REFERENCES public.registrations(id) ON DELETE CASCADE'),
        ('waitlists', 'waitlists_selected_by_admin_id_fkey', 'FOREIGN KEY (selected_by_admin_id) REFERENCES public.users(id)'),
        ('waitlists', 'waitlists_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE'),
        ('xero_accounts', 'xero_accounts_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES public.xero_oauth_tokens(tenant_id) ON DELETE CASCADE'),
        ('xero_contacts', 'xero_contacts_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES public.xero_oauth_tokens(tenant_id) ON DELETE CASCADE'),
        ('xero_contacts', 'xero_contacts_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE'),
        ('xero_invoice_line_items', 'fk_xero_invoice_line_items_discount_code_id', 'FOREIGN KEY (discount_code_id) REFERENCES public.discount_codes(id)'),
        ('xero_invoice_line_items', 'xero_invoice_line_items_xero_invoice_id_fkey', 'FOREIGN KEY (xero_invoice_id) REFERENCES public.xero_invoices(id) ON DELETE CASCADE'),
        ('xero_invoices', 'xero_invoices_payment_id_fkey', 'FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE'),
        ('xero_invoices', 'xero_invoices_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES public.xero_oauth_tokens(tenant_id) ON DELETE CASCADE'),
        ('xero_payments', 'xero_payments_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES public.xero_oauth_tokens(tenant_id) ON DELETE CASCADE'),
        ('xero_payments', 'xero_payments_xero_invoice_id_fkey', 'FOREIGN KEY (xero_invoice_id) REFERENCES public.xero_invoices(id) ON DELETE CASCADE'),
        ('xero_sync_logs', 'xero_sync_logs_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES public.xero_oauth_tokens(tenant_id) ON DELETE CASCADE'),
        ('xero_webhooks', 'xero_webhooks_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES public.xero_oauth_tokens(tenant_id) ON DELETE CASCADE')
    ) AS t(table_name, constraint_name, definition)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = fk.constraint_name
              AND conrelid = format('public.%I', fk.table_name)::regclass
        ) THEN
            EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s',
                           fk.table_name, fk.constraint_name, fk.definition);
        END IF;
    END LOOP;
END $$;


-- =============================================================================
-- INDEXES
-- =============================================================================
-- Primary-key and unique-constraint indexes are created by the constraints
-- above; only the standalone ones are listed here.

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON public.users USING btree (deleted_at);
CREATE INDEX IF NOT EXISTS idx_users_payment_plan_enabled ON public.users USING btree (payment_plan_enabled) WHERE (payment_plan_enabled = true);
CREATE INDEX IF NOT EXISTS idx_users_stripe_payment_method_id ON public.users USING btree (stripe_payment_method_id) WHERE (stripe_payment_method_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_categories_type ON public.categories USING btree (category_type);

CREATE INDEX IF NOT EXISTS idx_registrations_date_range ON public.registrations USING btree (start_date, end_date) WHERE ((start_date IS NOT NULL) AND (end_date IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_registrations_end_date ON public.registrations USING btree (end_date) WHERE (end_date IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_registrations_required_membership ON public.registrations USING btree (required_membership_id);
CREATE INDEX IF NOT EXISTS idx_registrations_start_date ON public.registrations USING btree (start_date) WHERE (start_date IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_registrations_survey ON public.registrations USING btree (survey_id) WHERE (survey_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_registration_categories_registration ON public.registration_categories USING btree (registration_id);
CREATE INDEX IF NOT EXISTS idx_registration_pricing_tiers_category ON public.registration_pricing_tiers USING btree (registration_category_id);
CREATE INDEX IF NOT EXISTS idx_registration_captains_registration_id ON public.registration_captains USING btree (registration_id);

CREATE INDEX IF NOT EXISTS idx_payments_stripe_intent ON public.payments USING btree (stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_time ON public.payments USING btree (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_refunds_payment_id ON public.refunds USING btree (payment_id);

CREATE INDEX IF NOT EXISTS idx_user_memberships_payment_id ON public.user_memberships USING btree (payment_id);
CREATE INDEX IF NOT EXISTS idx_user_memberships_user_membership ON public.user_memberships USING btree (user_id, membership_id);
CREATE INDEX IF NOT EXISTS idx_user_memberships_validity ON public.user_memberships USING btree (user_id, valid_from, valid_until);

CREATE INDEX IF NOT EXISTS idx_user_registrations_payment_id ON public.user_registrations USING btree (payment_id);
CREATE INDEX IF NOT EXISTS idx_user_registrations_refunded_at ON public.user_registrations USING btree (refunded_at) WHERE (refunded_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_registrations_registration_category_id ON public.user_registrations USING btree (registration_category_id);
CREATE INDEX IF NOT EXISTS idx_user_registrations_registration_id ON public.user_registrations USING btree (registration_id);
CREATE INDEX IF NOT EXISTS idx_user_registrations_reservation_expires ON public.user_registrations USING btree (reservation_expires_at) WHERE (payment_status = 'awaiting_payment'::text);
CREATE INDEX IF NOT EXISTS idx_user_registrations_stripe_payment_intent_id ON public.user_registrations USING btree (stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_user_registrations_xero_invoice_id ON public.user_registrations USING btree (xero_invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS user_registrations_active_unique ON public.user_registrations USING btree (user_id, registration_id) WHERE (payment_status = 'paid'::text);
CREATE UNIQUE INDEX IF NOT EXISTS user_registrations_xero_invoice_id_key ON public.user_registrations USING btree (xero_invoice_id) WHERE (xero_invoice_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_waitlists_category ON public.waitlists USING btree (registration_category_id, "position", removed_at);
CREATE INDEX IF NOT EXISTS idx_waitlists_registration_position ON public.waitlists USING btree (registration_id, "position");
CREATE INDEX IF NOT EXISTS idx_waitlists_registration_time ON public.waitlists USING btree (registration_id, joined_at);

CREATE INDEX IF NOT EXISTS idx_alternate_registrations_game_end_time ON public.alternate_registrations USING btree (game_end_time);
CREATE INDEX IF NOT EXISTS idx_alternate_registrations_registration_id ON public.alternate_registrations USING btree (registration_id);
CREATE INDEX IF NOT EXISTS idx_alternate_selections_alternate_registration_id ON public.alternate_selections USING btree (alternate_registration_id);
CREATE INDEX IF NOT EXISTS idx_alternate_selections_payment_id ON public.alternate_selections USING btree (payment_id);
CREATE INDEX IF NOT EXISTS idx_alternate_selections_user_id ON public.alternate_selections USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_user_alternate_registrations_discount_code_id ON public.user_alternate_registrations USING btree (discount_code_id);
CREATE INDEX IF NOT EXISTS idx_user_alternate_registrations_registration_id ON public.user_alternate_registrations USING btree (registration_id);
CREATE INDEX IF NOT EXISTS idx_user_alternate_registrations_user_id ON public.user_alternate_registrations USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_discount_codes_category_id ON public.discount_codes USING btree (discount_category_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_discount_codes_one_allowance_code_per_category ON public.discount_codes USING btree (discount_category_id) WHERE uses_user_allowance;
CREATE INDEX IF NOT EXISTS idx_discount_usage_category_season ON public.discount_usage USING btree (user_id, discount_category_id, season_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_discount_code_id ON public.discount_usage USING btree (discount_code_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_registration ON public.discount_usage USING btree (registration_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_season_id ON public.discount_usage USING btree (season_id);
CREATE INDEX IF NOT EXISTS idx_uda_created_by ON public.user_discount_allowances USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_uda_season_category ON public.user_discount_allowances USING btree (season_id, discount_category_id);
CREATE INDEX IF NOT EXISTS idx_uda_updated_by ON public.user_discount_allowances USING btree (updated_by);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_discount_allowance_user_season_default ON public.user_discount_allowances USING btree (user_id, season_id) WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_user_survey_responses_data ON public.user_survey_responses USING gin (response_data);
CREATE INDEX IF NOT EXISTS idx_user_survey_responses_survey_id ON public.user_survey_responses USING btree (survey_id);
CREATE INDEX IF NOT EXISTS idx_user_survey_responses_user_id ON public.user_survey_responses USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_email_logs_event_time ON public.email_logs USING btree (event_type, sent_at);
CREATE INDEX IF NOT EXISTS idx_email_logs_status_time ON public.email_logs USING btree (status, sent_at);
CREATE INDEX IF NOT EXISTS idx_email_logs_user_time ON public.email_logs USING btree (user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_email_change_logs_failures ON public.email_change_logs USING btree (event_type, created_at DESC) WHERE (event_type ~~ '%failed%'::text);
CREATE INDEX IF NOT EXISTS idx_email_change_logs_user_created ON public.email_change_logs USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_events_completed_at ON public.system_events USING btree (completed_at);
CREATE INDEX IF NOT EXISTS idx_system_events_event_type ON public.system_events USING btree (event_type);

CREATE INDEX IF NOT EXISTS idx_xero_oauth_tokens_tenant_id ON public.xero_oauth_tokens USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_xero_accounts_code ON public.xero_accounts USING btree (code);
CREATE INDEX IF NOT EXISTS idx_xero_accounts_status ON public.xero_accounts USING btree (status);
CREATE INDEX IF NOT EXISTS idx_xero_accounts_tenant_id ON public.xero_accounts USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_xero_contacts_tenant_id ON public.xero_contacts USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_xero_contacts_user_id ON public.xero_contacts USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_invoice_number ON public.xero_invoices USING btree (invoice_number);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_payment_id ON public.xero_invoices USING btree (payment_id);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_staging ON public.xero_invoices USING btree (sync_status, staged_at) WHERE (sync_status = ANY (ARRAY['pending'::text, 'staged'::text]));
CREATE INDEX IF NOT EXISTS idx_xero_invoices_sync_status ON public.xero_invoices USING btree (sync_status);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_tenant_id ON public.xero_invoices USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_xero_invoice_id ON public.xero_invoices USING btree (xero_invoice_id);
CREATE INDEX IF NOT EXISTS idx_xero_invoice_line_items_discount_code_id ON public.xero_invoice_line_items USING btree (discount_code_id);
CREATE INDEX IF NOT EXISTS idx_xero_invoice_line_items_xero_invoice_id ON public.xero_invoice_line_items USING btree (xero_invoice_id);
CREATE INDEX IF NOT EXISTS idx_xero_payments_invoice_installment ON public.xero_payments USING btree (xero_invoice_id, installment_number) WHERE (installment_number IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_xero_payments_payment_type ON public.xero_payments USING btree (payment_type);
CREATE INDEX IF NOT EXISTS idx_xero_payments_planned_ready ON public.xero_payments USING btree (sync_status, planned_payment_date) WHERE ((sync_status = 'planned'::text) AND (planned_payment_date IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_xero_payments_staging ON public.xero_payments USING btree (sync_status, staged_at) WHERE (sync_status = ANY (ARRAY['pending'::text, 'staged'::text]));
CREATE INDEX IF NOT EXISTS idx_xero_payments_sync_status ON public.xero_payments USING btree (sync_status);
CREATE INDEX IF NOT EXISTS idx_xero_payments_tenant_id ON public.xero_payments USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_xero_payments_xero_invoice_id ON public.xero_payments USING btree (xero_invoice_id);
CREATE INDEX IF NOT EXISTS idx_xero_payments_xero_payment_id ON public.xero_payments USING btree (xero_payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS xero_payments_xero_payment_id_unique ON public.xero_payments USING btree (xero_payment_id) WHERE (xero_payment_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_xero_sync_logs_created_at ON public.xero_sync_logs USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_xero_sync_logs_entity_type_id ON public.xero_sync_logs USING btree (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_xero_sync_logs_status ON public.xero_sync_logs USING btree (status);
CREATE INDEX IF NOT EXISTS idx_xero_sync_logs_tenant_id ON public.xero_sync_logs USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_xero_webhooks_tenant_id ON public.xero_webhooks USING btree (tenant_id);


-- =============================================================================
-- FUNCTIONS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_member_id()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    RETURN nextval('member_id_seq');
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_member_id_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NEW.member_id IS NULL THEN
        NEW.member_id := generate_member_id();
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_user_discount_allowances_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_registration_published_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.is_active = TRUE AND NEW.published_at IS NULL THEN
        NEW.published_at = NOW();
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin_user()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
        AND is_admin = true
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_payment_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    -- Emit PostgreSQL notification for async processing
    PERFORM pg_notify(
        'payment_completed',
        json_build_object(
            'event_type', TG_TABLE_NAME,
            'record_id', NEW.id,
            'user_id', NEW.user_id,
            'payment_id', CASE
                WHEN TG_TABLE_NAME = 'payments' THEN NEW.id
                ELSE NEW.payment_id
            END,
            'amount', CASE
                WHEN TG_TABLE_NAME = 'payments' THEN NEW.final_amount
                WHEN TG_TABLE_NAME = 'user_memberships' THEN COALESCE(NEW.amount_paid, 0)
                WHEN TG_TABLE_NAME = 'user_registrations' THEN COALESCE(NEW.amount_paid, 0)
                ELSE 0
            END,
            'trigger_source', TG_TABLE_NAME,
            'timestamp', NOW()
        )::text
    );
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_auth_audit_logs(target_user_id uuid DEFAULT NULL::uuid, limit_count integer DEFAULT 50, offset_count integer DEFAULT 0, start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, end_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, created_at timestamp with time zone, ip_address text, user_id uuid, email text, first_name text, last_name text, action text, payload json)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Admin access is verified in the API layer
  -- This function should only be called via service_role
  RETURN QUERY
  SELECT
    aal.id,
    aal.created_at,
    aal.ip_address::TEXT,
    (aal.payload->>'actor_id')::UUID as user_id,
    COALESCE(u.email, aal.payload->>'actor_username') as email,
    u.first_name,
    u.last_name,
    aal.payload->>'action' as action,
    aal.payload
  FROM auth.audit_log_entries aal
  LEFT JOIN users u ON u.id = (aal.payload->>'actor_id')::UUID
  WHERE
    CASE
      WHEN target_user_id IS NOT NULL
      THEN (aal.payload->>'actor_id')::UUID = target_user_id
      ELSE true
    END
    AND CASE
      WHEN start_date IS NOT NULL
      THEN aal.created_at >= start_date
      ELSE true
    END
    AND CASE
      WHEN end_date IS NOT NULL
      THEN aal.created_at <= end_date
      ELSE true
    END
  ORDER BY aal.created_at DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_oauth_email_mismatches()
 RETURNS TABLE(id uuid, account_email text, oauth_email text, first_name text, last_name text, last_sign_in_at timestamp with time zone, providers text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    au.id,
    au.email::TEXT AS account_email,
    (au.raw_user_meta_data->>'email')::TEXT AS oauth_email,
    u.first_name::TEXT,
    u.last_name::TEXT,
    au.last_sign_in_at,
    ARRAY(
      SELECT jsonb_array_elements_text(au.raw_app_meta_data->'providers')
    )::TEXT[] AS providers
  FROM auth.users au
  LEFT JOIN public.users u ON au.id = u.id
  WHERE
    -- User has Google OAuth (check providers array)
    au.raw_app_meta_data->'providers' ? 'google'
    -- Account email differs from OAuth email
    AND au.email IS DISTINCT FROM (au.raw_user_meta_data->>'email')::TEXT
    -- Exclude deleted/banned users
    AND au.deleted_at IS NULL
  ORDER BY au.last_sign_in_at DESC NULLS LAST;
END;
$function$;

-- Claims a batch of pending invoices for the Xero sync job. FOR UPDATE SKIP
-- LOCKED keeps concurrent sync runs from picking up the same rows.
CREATE OR REPLACE FUNCTION public.get_pending_xero_invoices_with_lock(limit_count integer DEFAULT 50)
 RETURNS TABLE(id uuid, payment_id uuid, tenant_id text, xero_invoice_id uuid, invoice_number text, invoice_type text, invoice_status text, total_amount integer, discount_amount integer, net_amount integer, stripe_fee_amount integer, sync_status text, last_synced_at timestamp with time zone, sync_error text, staged_at timestamp with time zone, staging_metadata jsonb, created_at timestamp with time zone, updated_at timestamp with time zone, is_payment_plan boolean, line_items jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH locked_invoices AS (
    -- First, lock the invoice rows to prevent race conditions
    SELECT xi.id, xi.payment_id, xi.tenant_id, xi.xero_invoice_id, xi.invoice_number,
           xi.invoice_type, xi.invoice_status, xi.total_amount, xi.discount_amount,
           xi.net_amount, xi.stripe_fee_amount, xi.sync_status, xi.last_synced_at,
           xi.sync_error, xi.staged_at, xi.staging_metadata, xi.created_at, xi.updated_at,
           xi.is_payment_plan
    FROM xero_invoices xi
    WHERE xi.sync_status = 'pending'
    ORDER BY xi.created_at ASC
    LIMIT limit_count
    FOR UPDATE SKIP LOCKED
  )
  SELECT
    xi.id,
    xi.payment_id,
    xi.tenant_id,
    xi.xero_invoice_id,
    xi.invoice_number,
    xi.invoice_type,
    xi.invoice_status,
    xi.total_amount,
    xi.discount_amount,
    xi.net_amount,
    xi.stripe_fee_amount,
    xi.sync_status,
    xi.last_synced_at,
    xi.sync_error,
    xi.staged_at,
    xi.staging_metadata,
    xi.created_at,
    xi.updated_at,
    xi.is_payment_plan,  -- Added for payment plan detection
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', xil.id,
          'line_item_type', xil.line_item_type,
          'item_id', xil.item_id,
          'description', xil.description,
          'quantity', xil.quantity,
          'unit_amount', xil.unit_amount,
          'account_code', xil.account_code,
          'tax_type', xil.tax_type,
          'line_amount', xil.line_amount,
          'discount_code_id', xil.discount_code_id
        )
        ORDER BY xil.created_at
      ) FILTER (WHERE xil.id IS NOT NULL),
      '[]'::jsonb
    ) AS line_items
  FROM locked_invoices xi
  LEFT JOIN xero_invoice_line_items xil ON xi.id = xil.xero_invoice_id
  GROUP BY xi.id, xi.payment_id, xi.tenant_id, xi.xero_invoice_id,
           xi.invoice_number, xi.invoice_type, xi.invoice_status,
           xi.total_amount, xi.discount_amount, xi.net_amount,
           xi.stripe_fee_amount, xi.sync_status, xi.last_synced_at,
           xi.sync_error, xi.staged_at, xi.staging_metadata,
           xi.created_at, xi.updated_at, xi.is_payment_plan
  ORDER BY xi.created_at ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_pending_xero_payments_with_lock(limit_count integer DEFAULT 50)
 RETURNS TABLE(id uuid, xero_invoice_id uuid, tenant_id text, xero_payment_id uuid, payment_method text, bank_account_code text, amount_paid integer, stripe_fee_amount integer, reference text, sync_status text, last_synced_at timestamp with time zone, sync_error text, staged_at timestamp with time zone, staging_metadata jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    xp.id,
    xp.xero_invoice_id,
    xp.tenant_id,
    xp.xero_payment_id,
    xp.payment_method,
    xp.bank_account_code,
    xp.amount_paid,
    xp.stripe_fee_amount,
    xp.reference,
    xp.sync_status,
    xp.last_synced_at,
    xp.sync_error,
    xp.staged_at,
    xp.staging_metadata,
    xp.created_at,
    xp.updated_at
  FROM xero_payments xp
  WHERE xp.sync_status = 'pending'
  ORDER BY xp.staged_at ASC
  LIMIT limit_count
  FOR UPDATE SKIP LOCKED;
END;
$function$;


-- =============================================================================
-- TRIGGERS
-- =============================================================================

DROP TRIGGER IF EXISTS set_member_id_trigger ON public.users;
CREATE TRIGGER set_member_id_trigger BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION set_member_id_on_insert();

DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_registrations_published_at ON public.registrations;
CREATE TRIGGER set_registrations_published_at BEFORE INSERT OR UPDATE OF is_active ON public.registrations FOR EACH ROW EXECUTE FUNCTION set_registration_published_at();

DROP TRIGGER IF EXISTS update_registrations_updated_at ON public.registrations;
CREATE TRIGGER update_registrations_updated_at BEFORE UPDATE ON public.registrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_registrations_updated_at ON public.user_registrations;
CREATE TRIGGER update_user_registrations_updated_at BEFORE UPDATE ON public.user_registrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_user_discount_allowances_updated_at ON public.user_discount_allowances;
CREATE TRIGGER trg_user_discount_allowances_updated_at BEFORE UPDATE ON public.user_discount_allowances FOR EACH ROW EXECUTE FUNCTION update_user_discount_allowances_updated_at();

DROP TRIGGER IF EXISTS update_xero_contacts_updated_at ON public.xero_contacts;
CREATE TRIGGER update_xero_contacts_updated_at BEFORE UPDATE ON public.xero_contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_xero_invoices_updated_at ON public.xero_invoices;
CREATE TRIGGER update_xero_invoices_updated_at BEFORE UPDATE ON public.xero_invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_xero_oauth_tokens_updated_at ON public.xero_oauth_tokens;
CREATE TRIGGER update_xero_oauth_tokens_updated_at BEFORE UPDATE ON public.xero_oauth_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_xero_payments_updated_at ON public.xero_payments;
CREATE TRIGGER update_xero_payments_updated_at BEFORE UPDATE ON public.xero_payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- =============================================================================
-- VIEWS
-- =============================================================================
-- All views use security_invoker=true so the querying user's RLS policies on the
-- underlying tables still apply. Created in dependency order: the reporting
-- views build on reports_financial_data.

CREATE OR REPLACE VIEW public.reports_financial_data WITH (security_invoker=true) AS
 SELECT xil.id AS line_item_id,
    xil.line_amount,
    xil.quantity,
    xil.line_item_type,
    xil.description,
    xil.discount_code_id,
    xil.item_id,
    xil.created_at AS line_item_created_at,
    xi.id AS invoice_id,
    xi.invoice_number,
    xi.invoice_type,
    xi.invoice_status,
    xi.sync_status,
    xi.created_at AS invoice_created_at,
    xi.updated_at AS invoice_updated_at,
    p.id AS payment_id,
    p.status AS payment_status,
        CASE
            WHEN p.status = 'refunded'::text THEN - p.final_amount
            ELSE p.final_amount
        END AS payment_amount,
    p.created_at AS payment_created_at,
    u.id AS user_id,
    u.first_name,
    u.last_name,
    u.email,
    dc.code AS discount_code,
    dc.discount_category_id,
    dcat.name AS discount_category_name,
        CASE
            WHEN xil.line_item_type = 'discount'::text THEN abs(xil.line_amount)
            ELSE xil.line_amount
        END AS absolute_amount,
    concat(u.first_name, ' ', u.last_name) AS customer_name,
    COALESCE(( SELECT sum(r.amount) AS sum
           FROM refunds r
          WHERE r.payment_id = p.id AND r.status = 'completed'::text), 0::numeric) AS total_refunded
   FROM xero_invoice_line_items xil
     JOIN xero_invoices xi ON xil.xero_invoice_id = xi.id
     LEFT JOIN payments p ON xi.payment_id = p.id
     LEFT JOIN users u ON p.user_id = u.id
     LEFT JOIN discount_codes dc ON xil.discount_code_id = dc.id
     LEFT JOIN discount_categories dcat ON dc.discount_category_id = dcat.id
  WHERE (xi.sync_status = ANY (ARRAY['synced'::text, 'pending'::text])) AND xi.invoice_status <> 'DRAFT'::text
  ORDER BY xi.created_at DESC;

CREATE OR REPLACE VIEW public.registration_reports_data WITH (security_invoker=true) AS
 SELECT rfd.line_item_id,
        CASE
            WHEN rfd.invoice_type = 'ACCRECCREDIT'::text THEN - abs(rfd.line_amount)
            ELSE rfd.line_amount
        END AS line_amount,
    rfd.quantity,
    rfd.line_item_type,
    rfd.description,
    rfd.discount_code_id,
    rfd.item_id,
    rfd.line_item_created_at,
    rfd.invoice_id,
    rfd.invoice_number,
    rfd.invoice_type,
    rfd.invoice_status,
    rfd.sync_status,
    rfd.invoice_created_at,
    rfd.invoice_updated_at,
    rfd.payment_id,
    rfd.payment_status,
        CASE
            WHEN rfd.invoice_type = 'ACCRECCREDIT'::text THEN - rfd.payment_amount
            ELSE rfd.payment_amount
        END AS payment_amount,
    rfd.payment_created_at,
    rfd.user_id,
    rfd.first_name,
    rfd.last_name,
    rfd.email,
    rfd.discount_code,
    rfd.discount_category_id,
    rfd.discount_category_name,
        CASE
            WHEN rfd.invoice_type = 'ACCRECCREDIT'::text THEN - abs(rfd.absolute_amount)
            ELSE rfd.absolute_amount
        END AS absolute_amount,
    rfd.customer_name,
    rfd.total_refunded,
    COALESCE(r.id, r2.id) AS registration_id,
    COALESCE(r.name, r2.name) AS registration_name,
    COALESCE(r.type, r2.type) AS registration_type,
    rc.id AS registration_category_id,
        CASE
            WHEN ur.id IS NULL AND r2.id IS NOT NULL THEN 'Alternate'::text
            ELSE rc.custom_name
        END AS registration_category_name,
    rc.price AS registration_category_price,
        CASE
            WHEN ur.id IS NULL AND r2.id IS NOT NULL THEN 'Alternate'::text
            ELSE c.name
        END AS category_name,
    COALESCE(s.id, s2.id) AS season_id,
    COALESCE(s.name, s2.name) AS season_name
   FROM reports_financial_data rfd
     LEFT JOIN user_registrations ur ON rfd.payment_id = ur.payment_id
     LEFT JOIN registrations r ON ur.registration_id = r.id
     LEFT JOIN registration_categories rc ON ur.registration_category_id = rc.id
     LEFT JOIN categories c ON rc.category_id = c.id
     LEFT JOIN seasons s ON r.season_id = s.id
     LEFT JOIN registrations r2 ON rfd.item_id = r2.id AND rfd.line_item_type = 'registration'::text AND ur.id IS NULL
     LEFT JOIN seasons s2 ON r2.season_id = s2.id
  WHERE rfd.line_item_type = 'registration'::text;

CREATE OR REPLACE VIEW public.membership_reports_data WITH (security_invoker=true) AS
 SELECT m.id AS membership_id,
    m.name AS membership_name,
    m.description AS membership_description,
    rfd.customer_name,
    rfd.invoice_created_at,
    rfd.invoice_updated_at,
        CASE
            WHEN rfd.invoice_type = 'ACCRECCREDIT'::text THEN - rfd.payment_amount
            ELSE rfd.payment_amount
        END AS payment_amount,
        CASE
            WHEN rfd.invoice_type = 'ACCRECCREDIT'::text THEN - abs(rfd.line_amount)
            ELSE rfd.line_amount
        END AS line_amount,
    rfd.line_item_id,
    rfd.invoice_id,
    rfd.invoice_number,
    rfd.invoice_type,
    rfd.payment_id,
    rfd.user_id,
    rfd.first_name,
    rfd.last_name,
    rfd.email,
        CASE
            WHEN rfd.invoice_type = 'ACCRECCREDIT'::text THEN - abs(rfd.absolute_amount)
            ELSE rfd.absolute_amount
        END AS absolute_amount
   FROM reports_financial_data rfd
     LEFT JOIN user_memberships um ON rfd.payment_id = um.payment_id
     RIGHT JOIN memberships m ON um.membership_id = m.id
  WHERE rfd.line_item_type = 'membership'::text AND rfd.payment_id IS NOT NULL;

CREATE OR REPLACE VIEW public.reports_active_memberships WITH (security_invoker=true) AS
 SELECT um.membership_id,
    m.name AS membership_name,
    count(DISTINCT um.user_id) AS active_member_count
   FROM user_memberships um
     JOIN users u ON um.user_id = u.id
     JOIN memberships m ON um.membership_id = m.id
  WHERE um.payment_status = 'paid'::text AND um.valid_until > now()
  GROUP BY um.membership_id, m.name
  ORDER BY (count(DISTINCT um.user_id)) DESC;

CREATE OR REPLACE VIEW public.membership_analytics_data WITH (security_invoker=true) AS
 WITH latest_memberships AS (
         SELECT DISTINCT ON (um.user_id, um.membership_id) um.user_id,
            um.membership_id,
            um.valid_until,
            um.valid_from,
            u.member_id,
            u.first_name,
            u.last_name,
            u.email,
            u.onboarding_completed_at,
            u.is_lgbtq,
            u.is_goalie,
            m.name AS membership_name,
            m.description AS membership_description
           FROM user_memberships um
             JOIN users u ON um.user_id = u.id
             JOIN memberships m ON um.membership_id = m.id
          WHERE um.payment_status = 'paid'::text AND um.valid_until >= CURRENT_DATE AND u.deleted_at IS NULL
          ORDER BY um.user_id, um.membership_id, um.valid_until DESC
        ), membership_stats AS (
         SELECT latest_memberships.membership_id,
            latest_memberships.membership_name,
            latest_memberships.membership_description,
            count(*) AS total_members,
            count(*) FILTER (WHERE latest_memberships.is_lgbtq = true) AS lgbtq_count,
            count(*) FILTER (WHERE latest_memberships.is_lgbtq IS NULL) AS prefer_not_to_say_count,
            count(*) FILTER (WHERE latest_memberships.is_goalie = true) AS goalie_count,
                CASE
                    WHEN (count(*) - count(*) FILTER (WHERE latest_memberships.is_lgbtq IS NULL)) > 0 THEN round(count(*) FILTER (WHERE latest_memberships.is_lgbtq = true)::numeric / (count(*) - count(*) FILTER (WHERE latest_memberships.is_lgbtq IS NULL))::numeric * 100::numeric, 1)
                    ELSE 0::numeric
                END AS lgbtq_percent
           FROM latest_memberships
          GROUP BY latest_memberships.membership_id, latest_memberships.membership_name, latest_memberships.membership_description
        )
 SELECT lm.user_id,
    lm.membership_id,
    lm.valid_until,
    lm.valid_from,
    lm.member_id,
    lm.first_name,
    lm.last_name,
    lm.email,
    lm.onboarding_completed_at,
    lm.is_lgbtq,
    lm.is_goalie,
    lm.membership_name,
    lm.membership_description,
    ms.total_members,
    ms.lgbtq_count,
    ms.prefer_not_to_say_count,
    ms.lgbtq_percent,
    ms.goalie_count,
    lm.valid_until - CURRENT_DATE AS days_to_expiration,
        CASE
            WHEN (lm.valid_until - CURRENT_DATE) < 0 THEN 'Expired'::text
            WHEN (lm.valid_until - CURRENT_DATE) <= 30 THEN 'Expiring Soon'::text
            WHEN (lm.valid_until - CURRENT_DATE) <= 90 THEN 'Expiring'::text
            ELSE 'Active'::text
        END AS expiration_status,
        CASE
            WHEN lm.is_lgbtq = true THEN 'LGBTQ+'::text
            WHEN lm.is_lgbtq = false THEN 'Ally'::text
            ELSE 'No Response'::text
        END AS lgbtq_status
   FROM latest_memberships lm
     JOIN membership_stats ms ON lm.membership_id = ms.membership_id
  ORDER BY lm.membership_id, lm.last_name, lm.first_name;

CREATE OR REPLACE VIEW public.user_memberships_consolidated WITH (security_invoker=true) AS
 SELECT um.user_id,
    um.membership_id,
    m.name AS membership_name,
    m.description AS membership_description,
    max(um.valid_until) AS latest_expiration,
    min(um.valid_from) AS member_since,
    max(um.valid_until) >= CURRENT_DATE AS is_active
   FROM user_memberships um
     JOIN memberships m ON m.id = um.membership_id
  WHERE um.payment_status = 'paid'::text
  GROUP BY um.user_id, um.membership_id, m.name, m.description
  ORDER BY (max(um.valid_until)) DESC;

CREATE OR REPLACE VIEW public.recent_transactions WITH (security_invoker=true) AS
 SELECT xi.id AS transaction_id,
    xi.invoice_number,
        CASE
            WHEN xi.invoice_type = 'ACCRECCREDIT'::text THEN - xi.net_amount
            ELSE xi.net_amount
        END AS amount,
    xi.invoice_status AS status,
    xi.created_at AS transaction_date,
    xi.staging_metadata,
    p.id AS payment_id,
    p.final_amount AS payment_amount,
    p.created_at AS payment_date,
    u.id AS user_id,
    u.first_name,
    u.last_name,
    u.email,
    u.member_id,
    COALESCE(( SELECT xili.line_item_type
           FROM xero_invoice_line_items xili
          WHERE xili.xero_invoice_id = xi.id
         LIMIT 1),
        CASE
            WHEN xi.invoice_type = 'ACCRECCREDIT'::text THEN 'credit_note'::text
            ELSE 'unknown'::text
        END) AS transaction_type,
    ( SELECT xili.item_id
           FROM xero_invoice_line_items xili
          WHERE xili.xero_invoice_id = xi.id
         LIMIT 1) AS item_id,
    xi.invoice_type
   FROM xero_invoices xi
     LEFT JOIN payments p ON xi.payment_id = p.id
     LEFT JOIN users u ON p.user_id = u.id
  WHERE xi.payment_id IS NOT NULL AND (xi.sync_status = ANY (ARRAY['synced'::text, 'pending'::text])) AND xi.invoice_status <> 'DRAFT'::text AND (xi.invoice_type = 'ACCREC'::text AND (p.status = ANY (ARRAY['completed'::text, 'refunded'::text])) OR xi.invoice_type = 'ACCRECCREDIT'::text)
  ORDER BY xi.created_at DESC;

CREATE OR REPLACE VIEW public.discount_usage_computed WITH (security_invoker=true) AS
 SELECT xil.id,
    u.id AS user_id,
    u.first_name AS user_first_name,
    u.last_name AS user_last_name,
    u.email AS user_email,
    u.member_id AS user_member_id,
    xil.discount_code_id,
    dc.discount_category_id,
    r.season_id,
    s.name AS season_name,
    s.start_date AS season_start_date,
    s.end_date AS season_end_date,
        CASE
            WHEN xi.invoice_type = 'ACCREC'::text THEN - xil.line_amount
            WHEN xi.invoice_type = 'ACCRECCREDIT'::text THEN xil.line_amount
            ELSE NULL::integer
        END AS amount_saved,
    xi.created_at AS used_at,
    xi.payment_id,
    r.id AS registration_id,
    r.name AS registration_name,
    dc.code AS discount_code,
    dcat.name AS discount_category_name,
    dcat.accounting_code AS discount_category_accounting_code,
    dcat.max_discount_per_user_per_season AS discount_category_max_per_season,
    xi.invoice_type,
    xi.invoice_number,
    xi.sync_status
   FROM xero_invoice_line_items xil
     LEFT JOIN xero_invoices xi ON xil.xero_invoice_id = xi.id
     LEFT JOIN discount_codes dc ON xil.discount_code_id = dc.id
     LEFT JOIN discount_categories dcat ON dcat.id = dc.discount_category_id
     LEFT JOIN alternate_selections asel ON xi.payment_id = asel.payment_id
     LEFT JOIN alternate_registrations ar ON asel.alternate_registration_id = ar.id
     LEFT JOIN payments p ON xi.payment_id = p.id
     LEFT JOIN users u ON u.id = p.user_id
     LEFT JOIN registrations r ON ar.registration_id = r.id
     LEFT JOIN seasons s ON s.id = r.season_id
  WHERE r.season_id IS NOT NULL AND (xi.sync_status = ANY (ARRAY['synced'::text, 'pending'::text])) AND xil.line_item_type = 'discount'::text
UNION
 SELECT xil.id,
    u.id AS user_id,
    u.first_name AS user_first_name,
    u.last_name AS user_last_name,
    u.email AS user_email,
    u.member_id AS user_member_id,
    xil.discount_code_id,
    dc.discount_category_id,
    r.season_id,
    s.name AS season_name,
    s.start_date AS season_start_date,
    s.end_date AS season_end_date,
        CASE
            WHEN xi.invoice_type = 'ACCREC'::text THEN - xil.line_amount
            WHEN xi.invoice_type = 'ACCRECCREDIT'::text THEN xil.line_amount
            ELSE NULL::integer
        END AS amount_saved,
    xi.created_at AS used_at,
    xi.payment_id,
    r.id AS registration_id,
    r.name AS registration_name,
    dc.code AS discount_code,
    dcat.name AS discount_category_name,
    dcat.accounting_code AS discount_category_accounting_code,
    dcat.max_discount_per_user_per_season AS discount_category_max_per_season,
    xi.invoice_type,
    xi.invoice_number,
    xi.sync_status
   FROM xero_invoice_line_items xil
     LEFT JOIN xero_invoices xi ON xil.xero_invoice_id = xi.id
     LEFT JOIN discount_codes dc ON xil.discount_code_id = dc.id
     LEFT JOIN discount_categories dcat ON dcat.id = dc.discount_category_id
     LEFT JOIN user_registrations ur ON xi.payment_id = ur.payment_id
     LEFT JOIN payments p ON xi.payment_id = p.id
     LEFT JOIN users u ON u.id = p.user_id
     LEFT JOIN registrations r ON ur.registration_id = r.id
     LEFT JOIN seasons s ON s.id = r.season_id
  WHERE r.season_id IS NOT NULL AND (xi.sync_status = ANY (ARRAY['synced'::text, 'pending'::text])) AND xil.line_item_type = 'discount'::text;

CREATE OR REPLACE VIEW public.payment_plan_summary WITH (security_invoker=true, security_barrier=true) AS
 SELECT xi.id AS invoice_id,
    (xi.staging_metadata ->> 'user_id'::text)::uuid AS contact_id,
    xi.payment_id AS first_payment_id,
    count(*) FILTER (WHERE xp.payment_type = 'installment'::text) AS total_installments,
    COALESCE(sum(xp.amount_paid) FILTER (WHERE xp.sync_status = ANY (ARRAY['synced'::text, 'pending'::text, 'processing'::text])), 0::bigint) AS paid_amount,
    sum(xp.amount_paid) AS total_amount,
    max(xp.planned_payment_date) AS final_payment_date,
    min(xp.planned_payment_date) FILTER (WHERE xp.sync_status = 'planned'::text) AS next_payment_date,
    count(*) FILTER (WHERE (xp.sync_status = ANY (ARRAY['synced'::text, 'pending'::text, 'processing'::text])) AND xp.payment_type = 'installment'::text) AS installments_paid,
        CASE
            WHEN count(*) FILTER (WHERE xp.sync_status = 'failed'::text) > 0 THEN 'failed'::text
            WHEN count(*) FILTER (WHERE xp.sync_status = ANY (ARRAY['planned'::text, 'staged'::text])) > 0 THEN 'active'::text
            ELSE 'completed'::text
        END AS status,
    ur.registration_id,
    COALESCE(r.name, NULLIF(regexp_replace(( SELECT xero_invoice_line_items.description
           FROM xero_invoice_line_items
          WHERE xero_invoice_line_items.xero_invoice_id = xi.id
          ORDER BY xero_invoice_line_items.id
         LIMIT 1), '^Registration:\s*'::text, ''::text), ''::text)) AS registration_name,
    s.name AS season_name,
    json_agg(json_build_object('id', xp.id, 'installment_number', xp.installment_number, 'amount', xp.amount_paid, 'planned_payment_date', xp.planned_payment_date, 'sync_status', xp.sync_status, 'attempt_count', xp.attempt_count, 'failure_reason', xp.failure_reason) ORDER BY xp.installment_number) AS installments
   FROM xero_invoices xi
     JOIN xero_payments xp ON xp.xero_invoice_id = xi.id
     LEFT JOIN user_registrations ur ON ur.xero_invoice_id = xi.id
     LEFT JOIN registrations r ON r.id = ur.registration_id
     LEFT JOIN seasons s ON s.id = r.season_id
  WHERE xi.is_payment_plan = true
  GROUP BY xi.id, xi.staging_metadata, xi.payment_id, ur.registration_id, r.name, s.name;


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- RLS is enabled on every table in `public`. Tables with no policy below
-- (access_code_usage, login_attempts, magic_link_tokens) are therefore
-- service-role-only: RLS with no policies denies all access to anon and
-- authenticated.

ALTER TABLE public.access_code_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alternate_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alternate_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_change_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.magic_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_captains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_pricing_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_accounting_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_alternate_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_discount_allowances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_webhooks ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- RLS POLICIES
-- =============================================================================
-- Each policy is dropped first so the file can be re-applied.

-- users -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own profile" ON public.users;
CREATE POLICY "Users can view their own profile" ON public.users FOR SELECT TO public
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.users;
CREATE POLICY "Users can insert their own profile" ON public.users FOR INSERT TO public
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
CREATE POLICY "Users can update their own profile" ON public.users FOR UPDATE TO public
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can view all users" ON public.users;
CREATE POLICY "Admins can view all users" ON public.users FOR ALL TO public
  USING (is_admin_user());

DROP POLICY IF EXISTS users_service_role_all ON public.users;
CREATE POLICY users_service_role_all ON public.users FOR ALL TO public
  USING (current_setting('role'::text) = 'service_role'::text);

-- seasons / memberships / categories / registrations (public catalog) ---------
DROP POLICY IF EXISTS "Anyone can view seasons" ON public.seasons;
CREATE POLICY "Anyone can view seasons" ON public.seasons FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "Only admins can modify seasons" ON public.seasons;
CREATE POLICY "Only admins can modify seasons" ON public.seasons FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Anyone can view memberships" ON public.memberships;
CREATE POLICY "Anyone can view memberships" ON public.memberships FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "Only admins can modify memberships" ON public.memberships;
CREATE POLICY "Only admins can modify memberships" ON public.memberships FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Anyone can view categories" ON public.categories;
CREATE POLICY "Anyone can view categories" ON public.categories FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "Only admins can create user categories" ON public.categories;
CREATE POLICY "Only admins can create user categories" ON public.categories FOR INSERT TO public
  WITH CHECK (category_type = 'user'::text AND (EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Only admins can modify their user categories" ON public.categories;
CREATE POLICY "Only admins can modify their user categories" ON public.categories FOR UPDATE TO public
  USING (category_type = 'user'::text AND created_by = auth.uid() AND (EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Anyone can view registrations" ON public.registrations;
CREATE POLICY "Anyone can view registrations" ON public.registrations FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "Only admins can modify registrations" ON public.registrations;
CREATE POLICY "Only admins can modify registrations" ON public.registrations FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Anyone can view registration categories" ON public.registration_categories;
CREATE POLICY "Anyone can view registration categories" ON public.registration_categories FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "Only admins can modify registration categories" ON public.registration_categories;
CREATE POLICY "Only admins can modify registration categories" ON public.registration_categories FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Anyone can view registration pricing tiers" ON public.registration_pricing_tiers;
CREATE POLICY "Anyone can view registration pricing tiers" ON public.registration_pricing_tiers FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS registration_pricing_tiers_admin_only ON public.registration_pricing_tiers;
CREATE POLICY registration_pricing_tiers_admin_only ON public.registration_pricing_tiers FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

-- registration_captains -------------------------------------------------------
DROP POLICY IF EXISTS "Captains can view their assignments" ON public.registration_captains;
CREATE POLICY "Captains can view their assignments" ON public.registration_captains FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can manage captains" ON public.registration_captains;
CREATE POLICY "Admins can manage captains" ON public.registration_captains FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.is_admin = true)));

-- payments / refunds / payment configuration ----------------------------------
DROP POLICY IF EXISTS "Users can view their own payments" ON public.payments;
CREATE POLICY "Users can view their own payments" ON public.payments FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own payments" ON public.payments;
CREATE POLICY "Users can insert their own payments" ON public.payments FOR INSERT TO public
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own payments" ON public.payments;
CREATE POLICY "Users can update their own payments" ON public.payments FOR UPDATE TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all payments" ON public.payments;
CREATE POLICY "Admins can view all payments" ON public.payments FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Admin access to refunds" ON public.refunds;
CREATE POLICY "Admin access to refunds" ON public.refunds FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin)));

DROP POLICY IF EXISTS payment_configurations_admin_only ON public.payment_configurations;
CREATE POLICY payment_configurations_admin_only ON public.payment_configurations FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

-- user_memberships ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own memberships" ON public.user_memberships;
CREATE POLICY "Users can view their own memberships" ON public.user_memberships FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own memberships" ON public.user_memberships;
CREATE POLICY "Users can insert their own memberships" ON public.user_memberships FOR INSERT TO public
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own memberships" ON public.user_memberships;
CREATE POLICY "Users can update their own memberships" ON public.user_memberships FOR UPDATE TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all memberships" ON public.user_memberships;
CREATE POLICY "Admins can view all memberships" ON public.user_memberships FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

-- user_registrations ----------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own registrations" ON public.user_registrations;
CREATE POLICY "Users can view their own registrations" ON public.user_registrations FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own registrations" ON public.user_registrations;
CREATE POLICY "Users can insert their own registrations" ON public.user_registrations FOR INSERT TO public
  WITH CHECK (auth.uid() = user_id);

-- Capacity counting: any signed-in user may see paid rows (count only).
DROP POLICY IF EXISTS "Anyone can count paid registrations" ON public.user_registrations;
CREATE POLICY "Anyone can count paid registrations" ON public.user_registrations FOR SELECT TO public
  USING (payment_status = 'paid'::text AND auth.role() = 'authenticated'::text);

DROP POLICY IF EXISTS "Admins can view all registrations" ON public.user_registrations;
CREATE POLICY "Admins can view all registrations" ON public.user_registrations FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

-- waitlists -------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own waitlist entries" ON public.waitlists;
CREATE POLICY "Users can view their own waitlist entries" ON public.waitlists FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can join waitlists" ON public.waitlists;
CREATE POLICY "Users can join waitlists" ON public.waitlists FOR INSERT TO public
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own waitlist entries" ON public.waitlists;
CREATE POLICY "Users can update their own waitlist entries" ON public.waitlists FOR UPDATE TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all waitlist entries" ON public.waitlists;
CREATE POLICY "Admins can view all waitlist entries" ON public.waitlists FOR SELECT TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Admins can manage all waitlist entries" ON public.waitlists;
CREATE POLICY "Admins can manage all waitlist entries" ON public.waitlists FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Admins can delete waitlist entries" ON public.waitlists;
CREATE POLICY "Admins can delete waitlist entries" ON public.waitlists FOR DELETE TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

-- alternates ------------------------------------------------------------------
DROP POLICY IF EXISTS "Captains and admins can view games" ON public.alternate_registrations;
CREATE POLICY "Captains and admins can view games" ON public.alternate_registrations FOR SELECT TO public
  USING ((EXISTS ( SELECT 1 FROM registration_captains rc WHERE rc.registration_id = alternate_registrations.registration_id AND rc.user_id = auth.uid())) OR (EXISTS ( SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.is_admin = true)));

DROP POLICY IF EXISTS "Captains and admins can create games" ON public.alternate_registrations;
CREATE POLICY "Captains and admins can create games" ON public.alternate_registrations FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1 FROM registration_captains rc WHERE rc.registration_id = alternate_registrations.registration_id AND rc.user_id = auth.uid())) OR (EXISTS ( SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.is_admin = true)));

DROP POLICY IF EXISTS "Captains and admins can update games" ON public.alternate_registrations;
CREATE POLICY "Captains and admins can update games" ON public.alternate_registrations FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1 FROM registration_captains rc WHERE rc.registration_id = alternate_registrations.registration_id AND rc.user_id = auth.uid())) OR (EXISTS ( SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.is_admin = true)));

DROP POLICY IF EXISTS "Captains and admins can delete games" ON public.alternate_registrations;
CREATE POLICY "Captains and admins can delete games" ON public.alternate_registrations FOR DELETE TO public
  USING ((EXISTS ( SELECT 1 FROM registration_captains rc WHERE rc.registration_id = alternate_registrations.registration_id AND rc.user_id = auth.uid())) OR (EXISTS ( SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.is_admin = true)));

DROP POLICY IF EXISTS "Users can view their own selections" ON public.alternate_selections;
CREATE POLICY "Users can view their own selections" ON public.alternate_selections FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Captains and admins can view selections" ON public.alternate_selections;
CREATE POLICY "Captains and admins can view selections" ON public.alternate_selections FOR SELECT TO public
  USING ((EXISTS ( SELECT 1 FROM alternate_registrations ar JOIN registration_captains rc ON rc.registration_id = ar.registration_id WHERE ar.id = alternate_selections.alternate_registration_id AND rc.user_id = auth.uid())) OR (EXISTS ( SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.is_admin = true)));

DROP POLICY IF EXISTS "Captains and admins can create selections" ON public.alternate_selections;
CREATE POLICY "Captains and admins can create selections" ON public.alternate_selections FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1 FROM alternate_registrations ar JOIN registration_captains rc ON rc.registration_id = ar.registration_id WHERE ar.id = alternate_selections.alternate_registration_id AND rc.user_id = auth.uid())) OR (EXISTS ( SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.is_admin = true)));

DROP POLICY IF EXISTS "Users can view their own alternate registrations" ON public.user_alternate_registrations;
CREATE POLICY "Users can view their own alternate registrations" ON public.user_alternate_registrations FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own alternate registrations" ON public.user_alternate_registrations;
CREATE POLICY "Users can insert their own alternate registrations" ON public.user_alternate_registrations FOR INSERT TO public
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own alternate registrations" ON public.user_alternate_registrations;
CREATE POLICY "Users can update their own alternate registrations" ON public.user_alternate_registrations FOR UPDATE TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own alternate registrations" ON public.user_alternate_registrations;
CREATE POLICY "Users can delete their own alternate registrations" ON public.user_alternate_registrations FOR DELETE TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins and captains can view alternate registrations" ON public.user_alternate_registrations;
CREATE POLICY "Admins and captains can view alternate registrations" ON public.user_alternate_registrations FOR SELECT TO public
  USING ((EXISTS ( SELECT 1 FROM registration_captains rc WHERE rc.registration_id = user_alternate_registrations.registration_id AND rc.user_id = auth.uid())) OR (EXISTS ( SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.is_admin = true)));

-- discounts -------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can read active discount categories for validation" ON public.discount_categories;
CREATE POLICY "Users can read active discount categories for validation" ON public.discount_categories FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS discount_categories_admin_only ON public.discount_categories;
CREATE POLICY discount_categories_admin_only ON public.discount_categories FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Users can read active discount codes for validation" ON public.discount_codes;
CREATE POLICY "Users can read active discount codes for validation" ON public.discount_codes FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "Users can view discount codes from their own registrations" ON public.discount_codes;
CREATE POLICY "Users can view discount codes from their own registrations" ON public.discount_codes FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1 FROM user_alternate_registrations uar WHERE uar.discount_code_id = discount_codes.id AND uar.user_id = auth.uid())));

DROP POLICY IF EXISTS discount_codes_admin_only ON public.discount_codes;
CREATE POLICY discount_codes_admin_only ON public.discount_codes FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Users can view their own discount usage" ON public.discount_usage;
CREATE POLICY "Users can view their own discount usage" ON public.discount_usage FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own discount usage" ON public.discount_usage;
CREATE POLICY "Users can insert their own discount usage" ON public.discount_usage FOR INSERT TO public
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all discount usage" ON public.discount_usage;
CREATE POLICY "Admins can view all discount usage" ON public.discount_usage FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS user_discount_allowances_user_read_own ON public.user_discount_allowances;
CREATE POLICY user_discount_allowances_user_read_own ON public.user_discount_allowances FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_discount_allowances_admin_all ON public.user_discount_allowances;
CREATE POLICY user_discount_allowances_admin_all ON public.user_discount_allowances FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

-- access codes ----------------------------------------------------------------
DROP POLICY IF EXISTS access_codes_admin_only ON public.access_codes;
CREATE POLICY access_codes_admin_only ON public.access_codes FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

-- survey responses ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can read own survey responses" ON public.user_survey_responses;
CREATE POLICY "Users can read own survey responses" ON public.user_survey_responses FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own survey responses" ON public.user_survey_responses;
CREATE POLICY "Users can view their own survey responses" ON public.user_survey_responses FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own survey responses" ON public.user_survey_responses;
CREATE POLICY "Users can insert own survey responses" ON public.user_survey_responses FOR INSERT TO public
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own survey responses" ON public.user_survey_responses;
CREATE POLICY "Users can insert their own survey responses" ON public.user_survey_responses FOR INSERT TO public
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own survey responses" ON public.user_survey_responses;
CREATE POLICY "Users can update their own survey responses" ON public.user_survey_responses FOR UPDATE TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own survey responses" ON public.user_survey_responses;
CREATE POLICY "Users can delete their own survey responses" ON public.user_survey_responses FOR DELETE TO public
  USING (auth.uid() = user_id);

-- email logging ---------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own email logs" ON public.email_logs;
CREATE POLICY "Users can view their own email logs" ON public.email_logs FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "System can insert email logs" ON public.email_logs;
CREATE POLICY "System can insert email logs" ON public.email_logs FOR INSERT TO public
  WITH CHECK (true);

DROP POLICY IF EXISTS "System can update email logs" ON public.email_logs;
CREATE POLICY "System can update email logs" ON public.email_logs FOR UPDATE TO public
  USING (true);

DROP POLICY IF EXISTS "Admins can view all email logs" ON public.email_logs;
CREATE POLICY "Admins can view all email logs" ON public.email_logs FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Users can view own email change logs" ON public.email_change_logs;
CREATE POLICY "Users can view own email change logs" ON public.email_change_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own email change logs" ON public.email_change_logs;
CREATE POLICY "Users can insert own email change logs" ON public.email_change_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all email change logs" ON public.email_change_logs;
CREATE POLICY "Admins can view all email change logs" ON public.email_change_logs FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

-- system ----------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow authenticated users to read system accounting codes" ON public.system_accounting_codes;
CREATE POLICY "Allow authenticated users to read system accounting codes" ON public.system_accounting_codes FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow admins to insert system accounting codes" ON public.system_accounting_codes;
CREATE POLICY "Allow admins to insert system accounting codes" ON public.system_accounting_codes FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Allow admins to update system accounting codes" ON public.system_accounting_codes;
CREATE POLICY "Allow admins to update system accounting codes" ON public.system_accounting_codes FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Admins can read system events" ON public.system_events;
CREATE POLICY "Admins can read system events" ON public.system_events FOR SELECT TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Service role can manage system events" ON public.system_events;
CREATE POLICY "Service role can manage system events" ON public.system_events FOR ALL TO public
  USING (auth.role() = 'service_role'::text);

-- xero ------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin only access to xero accounts" ON public.xero_accounts;
CREATE POLICY "Admin only access to xero accounts" ON public.xero_accounts FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)))
  WITH CHECK ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS xero_contacts_admin_only ON public.xero_contacts;
CREATE POLICY xero_contacts_admin_only ON public.xero_contacts FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS xero_invoices_admin_only ON public.xero_invoices;
CREATE POLICY xero_invoices_admin_only ON public.xero_invoices FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

-- Lets a member see the invoices behind their own discounts.
DROP POLICY IF EXISTS xero_invoices_user_discount_access ON public.xero_invoices;
CREATE POLICY xero_invoices_user_discount_access ON public.xero_invoices FOR SELECT TO public
  USING ((EXISTS ( SELECT 1 FROM payments p WHERE p.id = xero_invoices.payment_id AND p.user_id = auth.uid())));

DROP POLICY IF EXISTS xero_invoice_line_items_admin_only ON public.xero_invoice_line_items;
CREATE POLICY xero_invoice_line_items_admin_only ON public.xero_invoice_line_items FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS xero_invoice_line_items_user_discount_access ON public.xero_invoice_line_items;
CREATE POLICY xero_invoice_line_items_user_discount_access ON public.xero_invoice_line_items FOR SELECT TO public
  USING ((EXISTS ( SELECT 1 FROM xero_invoices xi LEFT JOIN payments p ON xi.payment_id = p.id WHERE xi.id = xero_invoice_line_items.xero_invoice_id AND p.user_id = auth.uid())));

DROP POLICY IF EXISTS xero_oauth_tokens_admin_only ON public.xero_oauth_tokens;
CREATE POLICY xero_oauth_tokens_admin_only ON public.xero_oauth_tokens FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS xero_payments_admin_only ON public.xero_payments;
CREATE POLICY xero_payments_admin_only ON public.xero_payments FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS xero_sync_logs_admin_only ON public.xero_sync_logs;
CREATE POLICY xero_sync_logs_admin_only ON public.xero_sync_logs FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS xero_webhooks_admin_only ON public.xero_webhooks;
CREATE POLICY xero_webhooks_admin_only ON public.xero_webhooks FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));


-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE public.alternate_registrations IS 'Tracks games/events within registrations that need alternates';
COMMENT ON TABLE public.alternate_selections IS 'Tracks which users are selected for specific games';
COMMENT ON VIEW public.discount_usage_computed IS 'Computed view of discount usage derived from xero_invoice_line_items. Provides single source of truth for discount tracking with proper reversal handling for credit notes. Includes user, season, and category details for reporting. RLS is enforced via security_invoker from underlying tables.';
COMMENT ON TABLE public.email_change_logs IS 'Audit trail for all email change activity. Append-only via API.';
COMMENT ON VIEW public.membership_analytics_data IS 'Comprehensive view for membership analytics with calculated statistics and member details. ADMIN ACCESS ONLY - This view contains sensitive member data and should only be accessed by admin users.';
COMMENT ON VIEW public.payment_plan_summary IS 'Aggregated view of payment plan status and installments from xero_payments. Includes registration data via user_registrations link, with fallback to invoice line item description for orphaned invoices. Uses COALESCE to handle NULL paid_amount when no payments are synced yet.';
COMMENT ON TABLE public.registration_captains IS 'Tracks captain assignments for registrations';
COMMENT ON VIEW public.registration_reports_data IS 'Registration financial data with fallback to item_id for alternates that do not have user_registrations entries';
COMMENT ON TABLE public.system_events IS 'Tracks system events like sync operations, maintenance tasks, etc.';
COMMENT ON TABLE public.user_alternate_registrations IS 'Tracks which users want to be alternates for which registrations';
COMMENT ON VIEW public.user_memberships_consolidated IS 'Consolidated view of user memberships grouped by membership type. Shows latest expiration date and active status for each membership type per user. Uses SECURITY INVOKER to respect RLS policies on underlying tables.';
COMMENT ON TABLE public.user_survey_responses IS 'Reusable survey responses per user, enables pre-fill functionality';
COMMENT ON TABLE public.xero_accounts IS 'Cached Xero chart of accounts for validation and autocomplete';
COMMENT ON TABLE public.xero_invoices IS 'Primary table for tracking Xero invoice synchronization status. Replaces legacy xero_synced fields.';
COMMENT ON TABLE public.xero_payments IS 'Primary table for tracking Xero payment synchronization status. Replaces legacy xero_synced fields.';

COMMENT ON COLUMN public.categories.is_goalie_only IS 'When true, only members who have identified as a goalie (users.is_goalie) may register in registration categories that reference this master category.';
COMMENT ON COLUMN public.memberships.allow_monthly IS 'Whether monthly pricing is available for this membership type. When false, only annual pricing is offered.';
COMMENT ON COLUMN public.payments.stripe_charge_id IS 'Stripe charge ID (ch_*) that appears on bank statements and is used for payment reconciliation';
COMMENT ON COLUMN public.payments.stripe_fee_amount IS 'Stripe processing fees in cents (2.9% + $0.30 standard rate)';
COMMENT ON COLUMN public.refunds.completed_at IS 'Timestamp when the refund was completed in Stripe';
COMMENT ON COLUMN public.refunds.stripe_charge_id IS 'Stripe Charge ID for complete Stripe data tracking (mirrors payments table)';
COMMENT ON COLUMN public.refunds.stripe_payment_intent_id IS 'Stripe Payment Intent ID for easy lookup and matching (mirrors payments table)';
COMMENT ON COLUMN public.registrations.allow_alternates IS 'Whether this registration allows alternates';
COMMENT ON COLUMN public.registrations.alternate_accounting_code IS 'Accounting code for alternate revenue';
COMMENT ON COLUMN public.registrations.alternate_price IS 'Price in cents for alternate spots';
COMMENT ON COLUMN public.registrations.end_date IS 'End datetime of the event/scrimmage (NULL for team registrations, required for events/scrimmages). Stored in UTC, displayed in Eastern Time. Must be >= start_date.';
COMMENT ON COLUMN public.registrations.published_at IS 'When this registration first went live (is_active set to true). Never cleared once set. NULL means it has never been published and is still safely deletable.';
COMMENT ON COLUMN public.registrations.require_survey IS 'If true, users must complete survey before proceeding to payment';
COMMENT ON COLUMN public.registrations.required_membership_id IS 'Optional default membership requirement for this registration. Categories can specify alternative memberships via registration_categories.required_membership_id. User qualifies if they have EITHER the registration-level OR category-level membership.';
COMMENT ON COLUMN public.registrations.start_date IS 'Start datetime of the event/scrimmage (NULL for team registrations, required for events/scrimmages). Stored in UTC, displayed in Eastern Time.';
COMMENT ON COLUMN public.registrations.survey_id IS 'External survey ID (Formbricks survey ID, Tally form ID, etc.)';
COMMENT ON COLUMN public.registrations.type IS 'Type of registration: team (season-long teams), scrimmage (single game), event (one-time event), tournament (multi-day competition with all-day scheduling)';
COMMENT ON COLUMN public.registrations.updated_at IS 'When the registration was last updated';
COMMENT ON COLUMN public.registrations.updated_by IS 'ID of the user who last updated the registration';
COMMENT ON COLUMN public.system_events.event_type IS 'Type of event: email_sync, xero_sync, maintenance, etc.';
COMMENT ON COLUMN public.system_events.initiator IS 'Who/what initiated the event: cron_job, manual (user name), system';
COMMENT ON COLUMN public.system_events.metadata IS 'Additional event-specific data as JSON';
COMMENT ON COLUMN public.system_events.status IS 'Event status: success, failed, partial';
COMMENT ON COLUMN public.user_memberships.xero_invoice_id IS 'Direct link to Xero invoice. Used for zero-value purchases that do not have payment records.';
COMMENT ON COLUMN public.user_registrations.refunded_at IS 'Timestamp when this registration was refunded (NULL if not refunded)';
COMMENT ON COLUMN public.user_registrations.reservation_expires_at IS 'When the spot reservation expires (user must complete payment before this time)';
COMMENT ON COLUMN public.user_registrations.updated_at IS 'Timestamp of last update to this record (auto-updated by trigger)';
COMMENT ON COLUMN public.user_registrations.xero_invoice_id IS 'Direct link to Xero invoice. Used for zero-value purchases that do not have payment records.';
COMMENT ON COLUMN public.user_survey_responses.completed_at IS 'When the user completed the survey';
COMMENT ON COLUMN public.user_survey_responses.response_data IS 'JSONB storage for survey responses from Tally webhook';
COMMENT ON COLUMN public.user_survey_responses.survey_id IS 'Tally form ID (e.g., VLzWBv)';
COMMENT ON COLUMN public.user_survey_responses.user_id IS 'Reference to users table';
COMMENT ON COLUMN public.users.payment_method_updated_at IS 'When payment method was last updated';
COMMENT ON COLUMN public.users.payment_plan_enabled IS 'Admin-controlled flag to enable payment plan option for this user';
COMMENT ON COLUMN public.users.preferences IS 'User preferences stored as JSON, e.g. { "adminFavorites": ["manage-seasons", ...] }';
COMMENT ON COLUMN public.users.setup_intent_status IS 'Status of the Setup Intent (pending, succeeded, failed)';
COMMENT ON COLUMN public.users.stripe_customer_id IS 'Stripe customer ID associated with this user for payment processing';
COMMENT ON COLUMN public.users.stripe_payment_method_id IS 'Saved payment method from Setup Intent';
COMMENT ON COLUMN public.users.stripe_setup_intent_id IS 'Stripe Setup Intent ID for saving payment methods';
COMMENT ON COLUMN public.waitlists.discount_code_id IS 'Optional discount code to be applied when user is selected from waitlist';
COMMENT ON COLUMN public.waitlists.selected_by_admin_id IS 'The admin user who selected this person from the waitlist';
COMMENT ON COLUMN public.xero_accounts.code IS 'Account code (e.g., "200", "SALES")';
COMMENT ON COLUMN public.xero_accounts.description IS 'Optional account description (max 4000 chars)';
COMMENT ON COLUMN public.xero_accounts.last_synced_at IS 'When this record was last updated from Xero API';
COMMENT ON COLUMN public.xero_accounts.name IS 'Account name (max 150 chars)';
COMMENT ON COLUMN public.xero_accounts.status IS 'Account status: ACTIVE or ARCHIVED';
COMMENT ON COLUMN public.xero_accounts.tenant_id IS 'Xero tenant (organization) identifier';
COMMENT ON COLUMN public.xero_accounts.type IS 'Account type: REVENUE, EXPENSE, ASSET, LIABILITY, EQUITY';
COMMENT ON COLUMN public.xero_accounts.xero_account_id IS 'Xero UUID for the account';
COMMENT ON COLUMN public.xero_invoice_line_items.discount_code_id IS 'Reference to discount_codes.id for actual discount codes. NULL for donation-type discounts (FINANCIAL_ASSISTANCE, FREE_MEMBERSHIP)';
COMMENT ON COLUMN public.xero_invoices.is_payment_plan IS 'Whether this invoice is for a payment plan (multiple installments)';
COMMENT ON COLUMN public.xero_invoices.sync_status IS 'pending=ready for sync, staged=created but not ready, processing=currently being synced, synced=successfully synced, failed=sync failed, ignore=skip retry (manual intervention required), abandoned=user cancelled purchase before payment';
COMMENT ON COLUMN public.xero_payments.attempt_count IS 'Number of charge attempts made for this installment (max 3 attempts)';
COMMENT ON COLUMN public.xero_payments.failure_reason IS 'Reason payment charge failed (for troubleshooting)';
COMMENT ON COLUMN public.xero_payments.installment_number IS 'Which installment this is (1-4) for payment plans, NULL for full payments';
COMMENT ON COLUMN public.xero_payments.last_attempt_at IS 'Timestamp of last charge attempt';
COMMENT ON COLUMN public.xero_payments.payment_type IS 'Type of payment: full (single payment) or installment (part of payment plan)';
COMMENT ON COLUMN public.xero_payments.planned_payment_date IS 'When this installment is scheduled to be charged (for planned status only)';
COMMENT ON COLUMN public.xero_payments.sync_status IS 'pending=ready for sync, staged=created but not ready, planned=future installment (internal only), cancelled=payment cancelled (early payoff superseded), processing=currently being synced, synced=successfully synced, failed=sync failed, ignore=skip retry (manual intervention required)';

COMMENT ON COLUMN public.membership_analytics_data.days_to_expiration IS 'Days until membership expires (negative if expired)';
COMMENT ON COLUMN public.membership_analytics_data.expiration_status IS 'Human-readable expiration status';
COMMENT ON COLUMN public.membership_analytics_data.goalie_count IS 'Number of goalie members';
COMMENT ON COLUMN public.membership_analytics_data.lgbtq_percent IS 'Percentage of LGBTQ+ members (excluding "prefer not to say")';
COMMENT ON COLUMN public.membership_analytics_data.lgbtq_status IS 'Human-readable LGBTQ+ status';

-- <<< 20260907000000_baseline_schema.sql <<<

-- >>> 20260907000001_reconcile_dev_to_baseline.sql >>>

-- =============================================================================
-- Reconcile a drifted database with the baseline schema
-- =============================================================================
--
-- Written on 2026-09-07 after comparing membership-system-dev against
-- membership-system-prod. Production is the reference; this file removes
-- objects that exist only in dev and fixes column/constraint mismatches, so a
-- long-lived database converges on 20260907000000_baseline_schema.sql.
--
-- Apply this to dev as: this file FIRST, then re-run the baseline. The baseline
-- is idempotent and creates everything dev is missing (policies, indexes,
-- foreign keys); this file only handles what the baseline cannot -- removals,
-- and changes to columns and constraints on tables that already exist.
--
-- Applying it to production is a no-op: every statement is conditional or
-- IF EXISTS, and production already matches the baseline.
--
-- ONE DESTRUCTIVE STATEMENT, flagged below: dropping the legacy
-- user_registrations.processing_expires_at column. It was superseded by
-- reservation_expires_at in July 2025 (the old migration left the DROP
-- commented out "for safety"); production dropped it, dev never did. The data
-- was copied to reservation_expires_at at the time.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------

-- Production requires a discount category on every code and every usage row.
-- These are only tightened when the local data allows it; otherwise the script
-- reports the offending rows and leaves the column nullable.
DO $$
DECLARE
    orphans bigint;
BEGIN
    SELECT count(*) INTO orphans FROM public.discount_codes WHERE discount_category_id IS NULL;
    IF orphans = 0 THEN
        ALTER TABLE public.discount_codes ALTER COLUMN discount_category_id SET NOT NULL;
    ELSE
        RAISE NOTICE 'Skipped discount_codes.discount_category_id SET NOT NULL: % row(s) still NULL', orphans;
    END IF;

    SELECT count(*) INTO orphans FROM public.discount_usage WHERE discount_category_id IS NULL;
    IF orphans = 0 THEN
        ALTER TABLE public.discount_usage ALTER COLUMN discount_category_id SET NOT NULL;
    ELSE
        RAISE NOTICE 'Skipped discount_usage.discount_category_id SET NOT NULL: % row(s) still NULL', orphans;
    END IF;
END $$;

-- New Xero invoices start as drafts.
ALTER TABLE public.xero_invoices ALTER COLUMN invoice_status SET DEFAULT 'DRAFT'::text;

-- DESTRUCTIVE: legacy column replaced by reservation_expires_at in
-- 2025-07-11-refactor-processing-to-awaiting-payment. Dropping it also drops
-- the idx_user_registrations_processing_expires index that depends on it.
ALTER TABLE public.user_registrations DROP COLUMN IF EXISTS processing_expires_at;


-- -----------------------------------------------------------------------------
-- 2. Constraints
-- -----------------------------------------------------------------------------

-- Dev-only foreign key. Production deliberately records email_logs.triggered_by_user_id
-- without one, so admin-sent log rows survive the admin's deletion.
ALTER TABLE public.email_logs DROP CONSTRAINT IF EXISTS email_logs_triggered_by_user_id_fkey;

-- Dev-only duplicate of refunds_amount_check (identical predicate).
ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS chk_refund_amount_not_negative;

-- Same constraint, different name: line dev up with production's naming.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlists_user_category_unique' AND conrelid = 'public.waitlists'::regclass)
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlists_user_id_registration_id_registration_category_id_key' AND conrelid = 'public.waitlists'::regclass) THEN
        ALTER TABLE public.waitlists RENAME CONSTRAINT waitlists_user_category_unique TO waitlists_user_id_registration_id_registration_category_id_key;
    END IF;
END $$;

-- Production prevents a registration from listing the same category (or the
-- same custom name) twice. Dev was built without these.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registration_categories_registration_id_category_id_key' AND conrelid = 'public.registration_categories'::regclass) THEN
        ALTER TABLE public.registration_categories ADD CONSTRAINT registration_categories_registration_id_category_id_key UNIQUE (registration_id, category_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registration_categories_registration_id_custom_name_key' AND conrelid = 'public.registration_categories'::regclass) THEN
        ALTER TABLE public.registration_categories ADD CONSTRAINT registration_categories_registration_id_custom_name_key UNIQUE (registration_id, custom_name);
    END IF;
END $$;


-- -----------------------------------------------------------------------------
-- 3. Indexes
-- -----------------------------------------------------------------------------

-- Dev-only index on the registration timing columns; production does not have it.
DROP INDEX IF EXISTS public.idx_registrations_timing;

-- Production indexes deleted_at unconditionally (dev's copy is partial), which
-- also serves lookups of non-deleted users.
DROP INDEX IF EXISTS public.idx_users_deleted_at;
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON public.users USING btree (deleted_at);


-- -----------------------------------------------------------------------------
-- 4. RLS policies that exist only in dev
-- -----------------------------------------------------------------------------
-- These are leftovers from superseded policy migrations. Production expresses
-- the same access through the differently named policies in the baseline, which
-- re-creates them when you run it after this file.
--
-- Two of these are looser than production and worth dropping on their own:
-- "Public can view paid registrations for capacity counting" exposes paid
-- user_registrations rows to anon, and the *_authenticated_read policies grant
-- blanket reads that production does not.

DROP POLICY IF EXISTS categories_admin_only ON public.categories;
DROP POLICY IF EXISTS memberships_admin_only ON public.memberships;
DROP POLICY IF EXISTS memberships_authenticated_read ON public.memberships;
DROP POLICY IF EXISTS registration_categories_admin_only ON public.registration_categories;
DROP POLICY IF EXISTS pricing_tiers_authenticated_read ON public.registration_pricing_tiers;
DROP POLICY IF EXISTS registrations_admin_only ON public.registrations;
DROP POLICY IF EXISTS registrations_authenticated_read ON public.registrations;
DROP POLICY IF EXISTS seasons_admin_only ON public.seasons;
DROP POLICY IF EXISTS seasons_authenticated_read ON public.seasons;
DROP POLICY IF EXISTS users_insert_own ON public.users;
DROP POLICY IF EXISTS users_select_own ON public.users;
DROP POLICY IF EXISTS users_update_own ON public.users;
DROP POLICY IF EXISTS "Authenticated users can count all paid registrations" ON public.user_registrations;
DROP POLICY IF EXISTS "Public can view paid registrations for capacity counting" ON public.user_registrations;
DROP POLICY IF EXISTS "Admin only for xero accounts modifications" ON public.xero_accounts;
DROP POLICY IF EXISTS "Authenticated users can read xero accounts" ON public.xero_accounts;


-- -----------------------------------------------------------------------------
-- Now re-run 20260907000000_baseline_schema.sql to add what dev is missing:
--   - policies: "Users can insert own email change logs" (email_change_logs),
--     "Admins can view all memberships" (user_memberships), "Admins can view
--     all registrations" and "Anyone can count paid registrations"
--     (user_registrations), and the users/seasons/memberships/registrations
--     policies under their production names
--   - index: idx_user_registrations_reservation_expires
-- -----------------------------------------------------------------------------

-- <<< 20260907000001_reconcile_dev_to_baseline.sql <<<

-- >>> 20260907000002_revoke_public_function_access.sql >>>

-- =============================================================================
-- Remove ad-hoc data-export functions and close the anon RPC hole
-- =============================================================================
--
-- Supabase exposes every function in `public` as a REST endpoint at
-- /rest/v1/rpc/<name>, and Supabase's default privileges grant EXECUTE on new
-- functions to `anon` and `authenticated` automatically. A SECURITY DEFINER
-- function runs as its owner and therefore ignores RLS, so any such function
-- created in `public` is readable by anyone holding the (public) anon key.
--
-- Three hand-written export helpers had accumulated in production this way --
-- get_users_data(), get_full_data() and get_current_data(), each still carrying
-- a "-- paste your SQL query here" line. Between them they returned every
-- member's first name, last name, email, member_id and membership expiry to
-- unauthenticated callers. They are referenced nowhere in the application.
--
-- This migration:
--   1. drops those three functions
--   2. revokes anon/authenticated EXECUTE on the functions that only the
--      service role should ever call
--   3. stops new functions from being granted to anon/authenticated by default
--
-- After applying, Supabase's Security Advisor should no longer report
-- 0028_anon_security_definer_function_executable for anything except the
-- functions listed under "deliberately left executable" below.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Drop the ad-hoc export functions
-- -----------------------------------------------------------------------------
-- If someone still needs these numbers, the reporting views (which are
-- security_invoker and therefore respect RLS) already cover them, and an admin
-- API route is the supported way to export.

DROP FUNCTION IF EXISTS public.get_users_data();
DROP FUNCTION IF EXISTS public.get_full_data();
DROP FUNCTION IF EXISTS public.get_current_data();


-- -----------------------------------------------------------------------------
-- 2. Revoke EXECUTE where only the service role should be calling
-- -----------------------------------------------------------------------------
-- Every .rpc() call in the application uses createAdminClient (service_role),
-- so nothing in the app loses access here. service_role keeps EXECUTE; it also
-- bypasses RLS by design and is only ever used server-side.

REVOKE EXECUTE ON FUNCTION public.get_auth_audit_logs(uuid, integer, integer, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_oauth_email_mismatches() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_pending_xero_invoices_with_lock(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_pending_xero_payments_with_lock(integer) FROM PUBLIC, anon, authenticated;

-- Not called from the application at all; it exists for set_member_id_on_insert,
-- which is SECURITY DEFINER and so calls it as the owner. Leaving it exposed
-- lets an anonymous caller burn member_id sequence values.
REVOKE EXECUTE ON FUNCTION public.generate_member_id() FROM PUBLIC, anon, authenticated;

-- Deliberately left executable by anon/authenticated:
--
--   is_admin_user()   -- referenced by the "Admins can view all users" policy on
--                        public.users. RLS policy expressions are evaluated as
--                        the querying role, so that role needs EXECUTE or every
--                        read of public.users fails.
--
--   update_updated_at_column(), set_member_id_on_insert(),
--   set_registration_published_at(), notify_payment_completion(),
--   update_user_discount_allowances_updated_at()
--                     -- trigger functions. Calling one over RPC raises
--                        "trigger functions can only be called as triggers",
--                        so the exposure is inert, and revoking EXECUTE risks
--                        breaking ordinary INSERT/UPDATE traffic if PostgreSQL
--                        re-checks the privilege when the trigger fires. Not
--                        worth the risk for no gain. Supabase's advisor will
--                        keep listing these; that is expected.


-- -----------------------------------------------------------------------------
-- 3. Stop granting EXECUTE on new functions automatically
-- -----------------------------------------------------------------------------
-- This is the control that would have prevented the original mistake: a
-- function created in `public` from the SQL editor is no longer reachable over
-- the REST API unless someone explicitly grants it.
--
-- Existing functions are unaffected (default privileges apply only to objects
-- created afterwards), so nothing changes for the running application.
--
-- A future function that genuinely needs to be callable from the browser must
-- now say so out loud, in its own migration:
--
--   GRANT EXECUTE ON FUNCTION public.my_function(...) TO authenticated;
--
-- Scope limit: default privileges are per-grantor. This covers objects created
-- by `postgres`, which is the role the Supabase SQL editor and the CLI use. It
-- does not cover `supabase_admin`, whose default privileges we cannot alter.

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated;

-- <<< 20260907000002_revoke_public_function_access.sql <<<

-- >>> 20260908154524_cleanup_remaining_function_advisor_findings.sql >>>

-- =============================================================================
-- Clean up the remaining findings from #291 (follow-up to #289 / #290)
-- =============================================================================
--
-- Supabase's advisor still lists four SECURITY DEFINER functions as callable
-- by anon/authenticated after 20260907000002_revoke_public_function_access.sql.
-- #291 investigated all four plus two additional anon-executable functions the
-- advisor doesn't surface (0028/0029 only report SECURITY DEFINER functions),
-- and confirmed none is currently exploitable. Two real items came out of that
-- investigation, handled here:
--
--   1. notify_payment_completion() is dead code: SECURITY DEFINER, anon/
--      authenticated executable, and attached to zero triggers (confirmed
--      against pg_trigger on both projects). Drop it.
--
--   2. set_registration_published_at() and
--      update_user_discount_allowances_updated_at() have a mutable
--      search_path (lint 0011), unlike every other function in `public`. Set
--      it explicitly.
--
-- Separately, this migration also revokes anon/authenticated EXECUTE on
-- update_updated_at_column() and set_member_id_on_insert() -- the two
-- remaining SECURITY DEFINER trigger functions besides is_admin_user(). The
-- prior migration left these alone out of caution that PostgreSQL might
-- re-check EXECUTE when a trigger fires. Verified on membership-system-dev
-- that this concern doesn't hold: PostgreSQL only checks EXECUTE on a trigger
-- function at CREATE TRIGGER time, not when the trigger fires, so revoking it
-- here does not affect any of the 8 existing triggers using these two
-- functions (tested with a real UPDATE as the `authenticated` role inside a
-- rolled-back transaction, with the grant already revoked -- the trigger
-- still fired and updated_at still changed).
--
-- is_admin_user() is deliberately left untouched. It is referenced by the
-- "Admins can view all users" RLS policy on public.users (`TO public`), and
-- RLS policy expressions are evaluated as the querying role -- revoking
-- EXECUTE there would turn every anon/authenticated read of public.users
-- into "permission denied for function is_admin_user".
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Drop the dead-code trigger function
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.notify_payment_completion();


-- -----------------------------------------------------------------------------
-- 2. Set a fixed search_path on the two functions missing one
-- -----------------------------------------------------------------------------

ALTER FUNCTION public.set_registration_published_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_user_discount_allowances_updated_at() SET search_path = public, pg_temp;


-- -----------------------------------------------------------------------------
-- 3. Revoke anon/authenticated EXECUTE on the remaining trigger functions
-- -----------------------------------------------------------------------------
-- set_member_id_on_insert() and update_updated_at_column() cannot be invoked
-- directly anyway ("trigger functions can only be called as triggers"), but
-- removing the grant clears the advisor lint for both and matches the intent
-- of the original revoke migration.

REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_member_id_on_insert() FROM PUBLIC, anon, authenticated;

-- <<< 20260908154524_cleanup_remaining_function_advisor_findings.sql <<<
