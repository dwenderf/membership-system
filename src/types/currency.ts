/**
 * Currency Types
 * 
 * Defines TypeScript types for currency amounts to prevent floating-point precision issues.
 * All monetary amounts should be stored and calculated as integers (cents).
 */

/**
 * Represents a monetary amount in cents (integer)
 * This type ensures that amounts are always integers, preventing floating-point precision issues
 */
export type Cents = number & { readonly __brand: 'Cents' }

/**
 * Internal function to ensure a number is a valid integer cents value
 * This function rounds the input to ensure it's a proper integer
 */
function ensureIntegerCents(amountInCents: number): Cents {
  return Math.round(amountInCents) as Cents
}

/**
 * Helper function to convert cents to Cents type (ensures integer)
 * This function rounds the input to ensure it's a proper integer cents value
 */
export function centsToCents(amountInCents: number): Cents {
  return ensureIntegerCents(amountInCents)
}

/**
 * Helper function to create negative Cents value (for donations given)
 * This function rounds the input and makes it negative
 */
export function negativeCents(amountInCents: number): Cents {
  return ensureIntegerCents(-amountInCents)
}

/**
 * Helper function to create a Cents value from dollars (converts to cents)
 * This function multiplies by 100 and rounds to ensure proper integer cents
 */
export function dollarsToCents(dollars: number): Cents {
  return ensureIntegerCents(dollars * 100)
}

/**
 * Helper function to convert cents back to dollars for display
 */
export function centsToDollars(cents: Cents): number {
  return cents / 100
}

/**
 * Type guard to check if a number is a valid Cents value
 */
export function isValidCents(value: number): value is Cents {
  return Number.isInteger(value) // Allow negative values for donations given
}

/**
 * Utility type for objects that contain monetary amounts
 */
export interface MonetaryAmount {
  amount: Cents
}

/**
 * Utility type for discount calculations
 */
export interface DiscountAmount {
  amount_saved: Cents
}

/**
 * Utility type for payment items
 */
export interface PaymentItem {
  amount: Cents
  description?: string
  accounting_code?: string
} 