/**
 * Payment Plan Utilities
 *
 * Shared constants and helper functions for payment plan status handling
 */

/** A single installment entry within the `installments` json_agg column of `payment_plan_summary`. */
export interface PaymentPlanInstallment {
  id: string
  installment_number: number | null
  amount: number
  planned_payment_date: string | null
  sync_status: string
  attempt_count: number
  failure_reason: string | null
}

/**
 * Row shape of the `payment_plan_summary` database view.
 * This view isn't in the generated Supabase types (supabase/migrations/2025-11-03-add-payment-plan-support.sql),
 * so its shape is maintained here by hand.
 */
export interface PaymentPlanSummaryRow {
  invoice_id: string
  contact_id: string | null
  first_payment_id: string | null
  total_installments: number
  paid_amount: number
  total_amount: number
  final_payment_date: string | null
  next_payment_date: string | null
  installments_paid: number
  status: string
  registration_id: string | null
  registration_name: string | null
  season_name: string | null
  installments: PaymentPlanInstallment[]
}

/**
 * Payment plan statuses that indicate the plan requires attention or has scheduled payments
 * - 'active': Plan has future scheduled payments
 * - 'failed': Plan has failed payments that need to be retried
 */
export const ACTIVE_PAYMENT_PLAN_STATUSES = ['active', 'failed'] as const

export type ActivePaymentPlanStatus = typeof ACTIVE_PAYMENT_PLAN_STATUSES[number]

/**
 * Check if a payment plan status indicates the plan is active or needs attention
 * Used for:
 * - Filtering plans in admin views
 * - Calculating next payment dates
 * - Determining which plans to display in expandable sections
 *
 * @param status - Payment plan status from payment_plan_summary view
 * @returns true if status is 'active' or 'failed', false otherwise
 */
export function isActivePlanStatus(status: string): boolean {
  return ACTIVE_PAYMENT_PLAN_STATUSES.includes(status as ActivePaymentPlanStatus)
}

/**
 * Filter payment plans to only those that are active or failed
 *
 * @param plans - Array of payment plans
 * @returns Filtered array containing only active and failed plans
 */
export function filterActivePlans<T extends { status: string }>(plans: T[]): T[] {
  return plans.filter(plan => isActivePlanStatus(plan.status))
}
