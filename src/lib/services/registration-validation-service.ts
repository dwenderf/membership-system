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

export interface MembershipValidationResult {
  hasRequiredMembership: boolean
  error?: string
  matchedMembership?: {
    id: string
    name: string
    source: 'registration' | 'category' | 'none'
  }
}

export interface UserMembership {
  id: string
  membership_id: string
  valid_from: string
  valid_until: string
  payment_status: string
  memberships?: {
    id: string
    name: string
  }
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

      // Check if payment method is valid (presence of stripe_payment_method_id is sufficient)
      if (!user.stripe_payment_method_id) {
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

  /**
   * Check if user has required membership for registration category
   *
   * Implements hierarchical membership requirements:
   * - Users can qualify with EITHER registration-level OR category-level membership
   * - If no requirements are set at either level, membership is not required
   * - Membership must be active (valid_until >= today) and paid
   *
   * @param registrationMembershipId - Required membership at registration level (optional)
   * @param categoryMembershipId - Required membership at category level (optional)
   * @param userMemberships - User's active memberships
   * @returns Validation result with matched membership details
   *
   * @example
   * // Chelsea Challenge scenario
   * validateMembershipRequirement(
   *   null, // No registration-level requirement
   *   'tournament-membership-id', // Category requires tournament membership
   *   userMemberships
   * ) // Returns true if user has tournament membership
   *
   * @example
   * // Standard registration with category alternative
   * validateMembershipRequirement(
   *   'standard-adult-id', // Registration requires Standard Adult
   *   'social-membership-id', // Social category accepts Social membership
   *   userMemberships
   * ) // Returns true if user has EITHER Standard Adult OR Social membership
   */
  static validateMembershipRequirement(
    registrationMembershipId: string | null,
    categoryMembershipId: string | null,
    userMemberships: UserMembership[]
  ): MembershipValidationResult {
    // Collect qualifying membership IDs from both levels
    const qualifyingMembershipIds = [
      registrationMembershipId,
      categoryMembershipId
    ].filter((id): id is string => id !== null && id !== undefined)

    // If no requirements at all, membership is not required
    if (qualifyingMembershipIds.length === 0) {
      return {
        hasRequiredMembership: true,
        matchedMembership: {
          id: '',
          name: 'No membership required',
          source: 'none'
        }
      }
    }

    const today = new Date().toISOString().split('T')[0]

    // Filter to active paid memberships
    const activeMemberships = userMemberships.filter(m =>
      m.payment_status === 'paid' &&
      m.valid_until >= today
    )

    // Check if user has any of the qualifying memberships
    for (const membership of activeMemberships) {
      if (qualifyingMembershipIds.includes(membership.membership_id)) {
        // Found a matching membership
        const source = membership.membership_id === registrationMembershipId ? 'registration' : 'category'

        return {
          hasRequiredMembership: true,
          matchedMembership: {
            id: membership.membership_id,
            name: membership.memberships?.name || 'Unknown',
            source
          }
        }
      }
    }

    // No matching membership found
    const requirementNames: string[] = []

    // We don't have membership names here, so we'll construct a generic message
    // The caller can provide more specific names if needed
    if (registrationMembershipId) {
      requirementNames.push('registration-level membership')
    }
    if (categoryMembershipId) {
      requirementNames.push('category-level membership')
    }

    const requirementText = requirementNames.join(' or ')

    return {
      hasRequiredMembership: false,
      error: `You need ${requirementText} to register for this event`
    }
  }

  /**
   * Async version of validateMembershipRequirement that fetches membership details
   *
   * This version queries the database to get membership names for better error messages.
   * Use this when you want user-friendly error messages with actual membership names.
   *
   * @param supabase - Supabase client
   * @param registrationMembershipId - Required membership at registration level
   * @param categoryMembershipId - Required membership at category level
   * @param userId - User to check
   * @returns Validation result with detailed membership information
   */
  static async validateMembershipRequirementAsync(
    supabase: SupabaseClient,
    registrationMembershipId: string | null,
    categoryMembershipId: string | null,
    userId: string
  ): Promise<MembershipValidationResult> {
    // Collect qualifying membership IDs
    const qualifyingMembershipIds = [
      registrationMembershipId,
      categoryMembershipId
    ].filter((id): id is string => id !== null && id !== undefined)

    // If no requirements, membership is not required
    if (qualifyingMembershipIds.length === 0) {
      return {
        hasRequiredMembership: true,
        matchedMembership: {
          id: '',
          name: 'No membership required',
          source: 'none'
        }
      }
    }

    const today = new Date().toISOString().split('T')[0]

    // Fetch user's memberships with membership details
    const { data: userMemberships, error } = await supabase
      .from('user_memberships')
      .select(`
        id,
        membership_id,
        valid_from,
        valid_until,
        payment_status,
        memberships:memberships(id, name)
      `)
      .eq('user_id', userId)
      .eq('payment_status', 'paid')
      .gte('valid_until', today)

    if (error) {
      throw new Error(`Failed to fetch user memberships: ${error.message}`)
    }

    // Check if user has any qualifying membership
    const matchingMembership = userMemberships?.find(m =>
      qualifyingMembershipIds.includes(m.membership_id)
    )

    if (matchingMembership) {
      const source = matchingMembership.membership_id === registrationMembershipId
        ? 'registration'
        : 'category'

      return {
        hasRequiredMembership: true,
        matchedMembership: {
          id: matchingMembership.membership_id,
          name: matchingMembership.memberships?.name || 'Unknown',
          source
        }
      }
    }

    // Fetch membership names for error message
    const { data: membershipDetails } = await supabase
      .from('memberships')
      .select('id, name')
      .in('id', qualifyingMembershipIds)

    const membershipNames = membershipDetails?.map(m => m.name) || []
    const requirementText = membershipNames.length > 1
      ? `${membershipNames.slice(0, -1).join(', ')} or ${membershipNames.slice(-1)}`
      : membershipNames[0] || 'required membership'

    return {
      hasRequiredMembership: false,
      error: `You need a ${requirementText} membership to register for this event`
    }
  }
}
