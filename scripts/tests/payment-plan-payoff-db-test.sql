-- DB-level checks for #452, run by scripts/verify-schema-applies.sh against the throwaway
-- database (CI `schema` job). Everything runs in a transaction that is rolled back.
--   * payment_plan_summary math after an early payoff (cancelled rows excluded)
--   * xero_payments_one_live_early_payoff rejects a second live payoff, allows a retry
BEGIN;
DO $$
DECLARE
  inv uuid := gen_random_uuid();
  s record;
  dup_rejected boolean := false;
BEGIN
  INSERT INTO public.xero_invoices (id, invoice_status, total_amount, net_amount, sync_status, is_payment_plan, staging_metadata)
  VALUES (inv, 'AUTHORISED', 12500, 12500, 'synced', true, jsonb_build_object('user_id', gen_random_uuid()));

  -- $125 plan: installment 1 paid, 2-4 planned
  INSERT INTO public.xero_payments (xero_invoice_id, amount_paid, sync_status, payment_type, installment_number, planned_payment_date)
  VALUES (inv, 3125, 'synced',  'installment', 1, current_date),
         (inv, 3125, 'planned', 'installment', 2, current_date + 30),
         (inv, 3125, 'planned', 'installment', 3, current_date + 60),
         (inv, 3125, 'planned', 'installment', 4, current_date + 90);

  SELECT * INTO s FROM public.payment_plan_summary WHERE invoice_id = inv;
  IF s.total_amount <> 12500 OR s.paid_amount <> 3125 OR s.status <> 'active' THEN
    RAISE EXCEPTION 'before payoff: total %, paid %, status % (want 12500/3125/active)', s.total_amount, s.paid_amount, s.status;
  END IF;

  -- Early payoff in flight: planned -> cancelled, staged full row for the remainder
  UPDATE public.xero_payments SET sync_status = 'cancelled' WHERE xero_invoice_id = inv AND sync_status = 'planned';
  INSERT INTO public.xero_payments (xero_invoice_id, amount_paid, sync_status, payment_type, staging_metadata)
  VALUES (inv, 9375, 'staged', 'full', '{"early_payoff": true}');

  SELECT * INTO s FROM public.payment_plan_summary WHERE invoice_id = inv;
  IF s.total_amount <> 12500 OR s.paid_amount <> 3125 THEN
    RAISE EXCEPTION 'mid-payoff: total %, paid % (want 12500/3125; was 21875 before #452)', s.total_amount, s.paid_amount;
  END IF;

  -- A second live payoff on the same invoice is rejected
  BEGIN
    INSERT INTO public.xero_payments (xero_invoice_id, amount_paid, sync_status, payment_type, staging_metadata)
    VALUES (inv, 9375, 'staged', 'full', '{"early_payoff": true}');
  EXCEPTION WHEN unique_violation THEN
    dup_rejected := true;
  END;
  IF NOT dup_rejected THEN
    RAISE EXCEPTION 'second live early payoff was not rejected by xero_payments_one_live_early_payoff';
  END IF;

  -- Marked paid: staged -> pending
  UPDATE public.xero_payments SET sync_status = 'pending' WHERE xero_invoice_id = inv AND payment_type = 'full';
  SELECT * INTO s FROM public.payment_plan_summary WHERE invoice_id = inv;
  IF s.total_amount <> 12500 OR s.paid_amount <> 12500 OR s.status <> 'completed' THEN
    RAISE EXCEPTION 'after payoff: total %, paid %, status % (want 12500/12500/completed)', s.total_amount, s.paid_amount, s.status;
  END IF;

  -- Rolled-back attempt (cancelled full row) doesn't block a new live payoff or count in totals
  UPDATE public.xero_payments SET sync_status = 'cancelled' WHERE xero_invoice_id = inv AND payment_type = 'full';
  UPDATE public.xero_payments SET sync_status = 'planned' WHERE xero_invoice_id = inv AND payment_type = 'installment' AND sync_status = 'cancelled';
  SELECT * INTO s FROM public.payment_plan_summary WHERE invoice_id = inv;
  IF s.total_amount <> 12500 OR s.status <> 'active' OR json_array_length(s.installments) <> 4 THEN
    RAISE EXCEPTION 'after rollback: total %, status %, installments % (want 12500/active/4)', s.total_amount, s.status, json_array_length(s.installments);
  END IF;
  INSERT INTO public.xero_payments (xero_invoice_id, amount_paid, sync_status, payment_type, staging_metadata)
  VALUES (inv, 9375, 'staged', 'full', '{"early_payoff": true}');

  RAISE NOTICE 'OK: payment_plan_summary payoff math and one-live-early-payoff index';
END $$;
ROLLBACK;
