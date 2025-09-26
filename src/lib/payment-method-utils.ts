/**
 * Utility functions for payment method formatting and display
 */

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
  if (!apiResponse?.paymentMethod) {
    return { hasPaymentMethod: false }
  }

  return {
    hasPaymentMethod: true,
    last4: apiResponse.paymentMethod.last4,
    brand: apiResponse.paymentMethod.brand,
    exp_month: apiResponse.paymentMethod.exp_month,
    exp_year: apiResponse.paymentMethod.exp_year
  }
}