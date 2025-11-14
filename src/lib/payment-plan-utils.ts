/**
 * Payment Plan Utilities
 *
 * Shared constants and helper functions for payment plan status handling
 */

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
