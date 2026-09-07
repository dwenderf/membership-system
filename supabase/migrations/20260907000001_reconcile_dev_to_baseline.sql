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
