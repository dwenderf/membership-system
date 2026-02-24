/**
 * Utility functions for payment method formatting, display, and validation
 */

/**
 * Returns true if the user has a valid saved payment method.
 *
 * Having a stripe_payment_method_id is the sole requirement. setup_intent_status
 * is intentionally NOT checked — payment methods can be attached via SetupIntent,
 * via payment intent with setup_future_usage, or via the Stripe Customer Portal.
 * In all cases the PM ID is the authoritative signal that a method is ready to charge.
 */
export function userHasValidPaymentMethod(
  user: { stripe_payment_method_id?: string | null } | null | undefined
): boolean {
  return !!user?.stripe_payment_method_id
}

export interface PaymentMethodInfo {
  hasPaymentMethod: boolean
  last4?: string
  brand?: string
  exp_month?: number
  exp_year?: number
}

/**
 * Formats a payment method for consistent display across the application
 * Returns format like "VISA •••• 4242" or "Saved payment method" as fallback
 */
export function formatPaymentMethodDescription(paymentMethod?: {
  last4?: string
  brand?: string
  exp_month?: number
  exp_year?: number
} | null): string {
  if (!paymentMethod?.last4 || !paymentMethod?.brand) {
    return 'Saved payment method'
  }

  // Format brand name consistently (uppercase first letter, rest lowercase)
  const formattedBrand = paymentMethod.brand.charAt(0).toUpperCase() + 
                        paymentMethod.brand.slice(1).toLowerCase()

  return `${formattedBrand} •••• ${paymentMethod.last4}`
}

/**
 * Formats payment method with expiration for detailed display
 * Returns format like "VISA •••• 4242 (12/25)"
 */
export function formatPaymentMethodWithExpiry(paymentMethod?: {
  last4?: string
  brand?: string
  exp_month?: number
  exp_year?: number
} | null): string {
  const baseDescription = formatPaymentMethodDescription(paymentMethod)
  
  if (!paymentMethod?.exp_month || !paymentMethod?.exp_year) {
    return baseDescription
  }

  // Format expiry as MM/YY
  const month = paymentMethod.exp_month.toString().padStart(2, '0')
  const year = paymentMethod.exp_year.toString().slice(-2)
  
  return `${baseDescription} (${month}/${year})`
}

/**
 * Gets the payment method info from the API response format
 */
export function extractPaymentMethodInfo(apiResponse: any): PaymentMethodInfo {
  if (!apiResponse?.paymentMethod?.card) {
    return { hasPaymentMethod: false }
  }

  const card = apiResponse.paymentMethod.card

  return {
    hasPaymentMethod: true,
    last4: card.last4,
    brand: card.brand,
    exp_month: card.exp_month,
    exp_year: card.exp_year
  }
}