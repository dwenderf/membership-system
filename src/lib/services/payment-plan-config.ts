/**
 * Payment Plan Configuration
 * Centralized constants for payment plan behavior
 */

/**
 * Maximum number of charge attempts for failed payments
 * After this many attempts, payment is marked as permanently failed
 */
export const MAX_PAYMENT_ATTEMPTS = 3

/**
 * Number of installments in a payment plan
 */
export const PAYMENT_PLAN_INSTALLMENTS = 4

/**
 * Interval between installments in days
 */
export const INSTALLMENT_INTERVAL_DAYS = 30

/**
 * Hours to wait before retrying a failed payment
 */
export const RETRY_INTERVAL_HOURS = 24
