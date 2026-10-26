-- waitlists.use_payment_plan: the member's payment-plan choice when joining a waitlist (#442).
--
-- When true and the member is still payment-plan eligible at selection time, selection charges
-- the first of the standard 4 installments instead of the full amount. If they are no longer
-- eligible, selection charges in full (the choice is a preference, not a guarantee).
--
-- Additive only: NOT NULL with a default, so existing rows read as false and no backfill is
-- needed. Nothing is dropped or renamed. Rollback: ALTER TABLE public.waitlists DROP COLUMN
-- use_payment_plan (once no deployed code reads it).
ALTER TABLE public.waitlists
  ADD COLUMN IF NOT EXISTS use_payment_plan boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.waitlists.use_payment_plan IS
  'Member opted into a payment plan when joining the waitlist. Honoured at selection only if the member is still payment-plan eligible; otherwise charged in full.';
