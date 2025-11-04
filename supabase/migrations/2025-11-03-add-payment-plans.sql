-- Payment Plans Feature Migration
-- Adds support for installment payment plans on registrations

-- 1. Add payment plan eligibility flag to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_plan_enabled BOOLEAN DEFAULT FALSE;

-- Create partial index for payment plan eligible users (for efficient queries)
CREATE INDEX IF NOT EXISTS idx_users_payment_plan_enabled
ON users(payment_plan_enabled)
WHERE payment_plan_enabled = true;

-- 2. Create payment_plans table
CREATE TABLE IF NOT EXISTS payment_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_registration_id UUID NOT NULL REFERENCES user_registrations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_amount INTEGER NOT NULL, -- Total registration amount in cents
    paid_amount INTEGER DEFAULT 0, -- Amount paid so far in cents
    installment_amount INTEGER NOT NULL, -- Amount per installment (25% of total) in cents
    installments_count INTEGER DEFAULT 4, -- Total number of installments
    installments_paid INTEGER DEFAULT 0, -- Number of installments completed
    next_payment_date DATE NOT NULL, -- Date of next scheduled payment
    first_payment_immediate BOOLEAN DEFAULT true, -- Always true - first payment is immediate
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
    xero_invoice_id UUID REFERENCES xero_invoices(id), -- Link to Xero invoice staging record
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Ensure one payment plan per registration
    CONSTRAINT unique_payment_plan_per_registration UNIQUE(user_registration_id)
);

-- Indexes for payment_plans
CREATE INDEX IF NOT EXISTS idx_payment_plans_user_id
ON payment_plans(user_id);

CREATE INDEX IF NOT EXISTS idx_payment_plans_user_registration_id
ON payment_plans(user_registration_id);

CREATE INDEX IF NOT EXISTS idx_payment_plans_status
ON payment_plans(status);

-- Partial index for active plans with scheduled payments (for cron job efficiency)
CREATE INDEX IF NOT EXISTS idx_payment_plans_next_payment_date
ON payment_plans(next_payment_date)
WHERE status = 'active';

-- 3. Create payment_plan_transactions table
CREATE TABLE IF NOT EXISTS payment_plan_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_plan_id UUID NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    amount INTEGER NOT NULL, -- Amount for this installment in cents
    installment_number INTEGER NOT NULL, -- Which installment (1-4)
    scheduled_date DATE NOT NULL, -- Original scheduled date
    processed_date TIMESTAMP WITH TIME ZONE, -- When payment was successfully processed
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    failure_reason TEXT, -- Reason for payment failure
    stripe_payment_intent_id TEXT UNIQUE, -- Stripe payment intent for this transaction

    -- Retry tracking fields
    last_attempt_at TIMESTAMP WITH TIME ZONE, -- When the last payment attempt was made
    attempt_count INTEGER DEFAULT 0, -- Number of payment attempts made
    max_attempts INTEGER DEFAULT 3, -- Maximum retry attempts (3 retries after initial attempt)

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Ensure installment numbers are unique per payment plan
    CONSTRAINT unique_installment_per_plan UNIQUE(payment_plan_id, installment_number)
);

-- Indexes for payment_plan_transactions
CREATE INDEX IF NOT EXISTS idx_payment_plan_transactions_payment_plan_id
ON payment_plan_transactions(payment_plan_id);

CREATE INDEX IF NOT EXISTS idx_payment_plan_transactions_payment_id
ON payment_plan_transactions(payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_plan_transactions_status
ON payment_plan_transactions(status);

-- Partial index for pending payments due today or earlier (for cron job efficiency)
CREATE INDEX IF NOT EXISTS idx_payment_plan_transactions_scheduled_date
ON payment_plan_transactions(scheduled_date, last_attempt_at, attempt_count)
WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_payment_plan_transactions_stripe_payment_intent_id
ON payment_plan_transactions(stripe_payment_intent_id)
WHERE stripe_payment_intent_id IS NOT NULL;

-- 4. Add updated_at triggers
-- Check if update_updated_at_column function exists, create if not
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
    ) THEN
        CREATE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $func$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql;
    END IF;
END $$;

-- Create triggers for updated_at columns
DROP TRIGGER IF EXISTS update_payment_plans_updated_at ON payment_plans;
CREATE TRIGGER update_payment_plans_updated_at
    BEFORE UPDATE ON payment_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_payment_plan_transactions_updated_at ON payment_plan_transactions;
CREATE TRIGGER update_payment_plan_transactions_updated_at
    BEFORE UPDATE ON payment_plan_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 5. Add helpful comments
COMMENT ON TABLE payment_plans IS 'Stores payment plan information for registrations paid in installments';
COMMENT ON TABLE payment_plan_transactions IS 'Tracks individual installment transactions for payment plans';
COMMENT ON COLUMN users.payment_plan_enabled IS 'Admin-controlled flag to enable payment plan option for this user';
COMMENT ON COLUMN payment_plans.first_payment_immediate IS 'Always true - first payment is processed immediately during registration';
COMMENT ON COLUMN payment_plan_transactions.attempt_count IS 'Number of payment attempts made (0 = not yet attempted, 1 = initial attempt, 2+ = retries)';
COMMENT ON COLUMN payment_plan_transactions.max_attempts IS 'Maximum number of total attempts (initial + retries) before giving up';

-- =============================================
-- 6. ENABLE ROW LEVEL SECURITY (RLS)
-- =============================================

-- Enable RLS on payment plan tables
ALTER TABLE payment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_plan_transactions ENABLE ROW LEVEL SECURITY;

-- =============================================
-- PAYMENT_PLANS RLS POLICIES
-- =============================================

-- Allow users to view their own payment plans
CREATE POLICY "Users can view own payment plans"
  ON payment_plans
  FOR SELECT
  USING (
    auth.uid() = user_id
  );

-- Allow admins to view all payment plans
CREATE POLICY "Admins can view all payment plans"
  ON payment_plans
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.is_admin = true
    )
  );

-- Only service role can insert payment plans (done via backend API)
-- No INSERT policy needed - will use service role key

-- Only service role can update payment plans (done via backend API)
-- No UPDATE policy needed - will use service role key

-- Only service role can delete payment plans (done via backend API)
-- No DELETE policy needed - will use service role key

-- =============================================
-- PAYMENT_PLAN_TRANSACTIONS RLS POLICIES
-- =============================================

-- Allow users to view transactions for their own payment plans
CREATE POLICY "Users can view own payment plan transactions"
  ON payment_plan_transactions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM payment_plans
      WHERE payment_plans.id = payment_plan_transactions.payment_plan_id
      AND payment_plans.user_id = auth.uid()
    )
  );

-- Allow admins to view all payment plan transactions
CREATE POLICY "Admins can view all payment plan transactions"
  ON payment_plan_transactions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.is_admin = true
    )
  );

-- Only service role can insert transactions (done via backend API)
-- No INSERT policy needed - will use service role key

-- Only service role can update transactions (done via backend API)
-- No UPDATE policy needed - will use service role key

-- Only service role can delete transactions (done via backend API)
-- No DELETE policy needed - will use service role key

-- =============================================
-- RLS POLICY COMMENTS
-- =============================================

COMMENT ON POLICY "Users can view own payment plans" ON payment_plans IS
  'Allows authenticated users to view their own payment plans';

COMMENT ON POLICY "Admins can view all payment plans" ON payment_plans IS
  'Allows admin users to view all payment plans for reporting and support';

COMMENT ON POLICY "Users can view own payment plan transactions" ON payment_plan_transactions IS
  'Allows authenticated users to view transactions for their own payment plans';

COMMENT ON POLICY "Admins can view all payment plan transactions" ON payment_plan_transactions IS
  'Allows admin users to view all payment plan transactions for reporting and support';
