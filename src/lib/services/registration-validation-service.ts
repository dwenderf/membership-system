import { SupabaseClient } from '@supabase/supabase-js'

export interface RegistrationValidationResult {
  canRegister: boolean
  error?: string
  existingRegistration?: {
    id: string
    payment_status: string
  }
}

export interface PaymentMethodValidationResult {
  isValid: boolean
  error?: string
}

/**
 * Service for common registration validation logic
 * Ensures consistent validation across different registration flows
 */
export class RegistrationValidationService {
  /**
   * Check if a user can register for an event
   * Only considers active/paid registrations as blocking
   * Refunded registrations do NOT block re-registration
   */
  static async canUserRegister(
    supabase: SupabaseClient,
    userId: string,
    registrationId: string
  ): Promise<RegistrationValidationResult> {
    try {
      // Check for existing PAID registration
      // Refunded registrations are excluded by the payment_status filter
      const { data: existingRegistration, error } = await supabase
        .from('user_registrations')
        .select('id, payment_status')
        .eq('user_id', userId)
        .eq('registration_id', registrationId)
        .eq('payment_status', 'paid')
        .single()

      if (error) {
        // PGRST116 = no rows returned (which is what we want)
        if (error.code === 'PGRST116') {
          return { canRegister: true }
        }
        // Other errors should be handled
        throw error
      }

      // If we found a paid registration, user cannot register again
      if (existingRegistration) {
        return {
          canRegister: false,
          error: 'User is already registered for this event',
          existingRegistration
        }
      }

      return { canRegister: true }
    } catch (error) {
      throw new Error(
        `Failed to check registration status: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Validate that a user has a valid payment method
   * Should only be called when payment is actually required (amount > 0)
   */
  static async validatePaymentMethod(
    supabase: SupabaseClient,
    userId: string
  ): Promise<PaymentMethodValidationResult> {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('stripe_payment_method_id, setup_intent_status')
        .eq('id', userId)
        .single()

      if (error || !user) {
        throw new Error('User not found')
      }

      // Check if payment method is valid
      const hasValidPaymentMethod =
        user.stripe_payment_method_id && user.setup_intent_status === 'succeeded'

      if (!hasValidPaymentMethod) {
        return {
          isValid: false,
          error: 'User does not have a valid payment method'
        }
      }

      return { isValid: true }
    } catch (error) {
      throw new Error(
        `Failed to validate payment method: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Comprehensive validation for registration eligibility
   * Combines duplicate check and payment method validation
   *
   * IMPORTANT: Only use this when you know the FINAL price after all discounts.
   * If discounts might apply (e.g., waitlist with discount codes), use canUserRegister()
   * and validate payment method AFTER calculating the final discounted amount.
   *
   * Example:
   * - Normal registration: Use this with final calculated price ✅
   * - Waitlist selection: Use canUserRegister() only, validate payment in service ✅
   */
  static async validateRegistrationEligibility(
    supabase: SupabaseClient,
    userId: string,
    registrationId: string,
    options: {
      requirePaymentMethod?: boolean
      effectivePrice?: number
    } = {}
  ): Promise<{
    canRegister: boolean
    error?: string
    reason?: 'duplicate_registration' | 'invalid_payment_method'
  }> {
    // First check for duplicate registration
    const registrationCheck = await this.canUserRegister(supabase, userId, registrationId)
    if (!registrationCheck.canRegister) {
      return {
        canRegister: false,
        error: registrationCheck.error,
        reason: 'duplicate_registration'
      }
    }

    // Then check payment method if required
    // Only validate payment method if:
    // 1. Explicitly required via options.requirePaymentMethod, OR
    // 2. effectivePrice is provided and > 0
    const shouldValidatePayment =
      options.requirePaymentMethod ||
      (options.effectivePrice !== undefined && options.effectivePrice > 0)

    if (shouldValidatePayment) {
      const paymentMethodCheck = await this.validatePaymentMethod(supabase, userId)
      if (!paymentMethodCheck.isValid) {
        return {
          canRegister: false,
          error: paymentMethodCheck.error,
          reason: 'invalid_payment_method'
        }
      }
    }

    return { canRegister: true }
  }
}
