/**
 * Accounting Code Helper
 * 
 * Centralized system for retrieving accounting codes across the application.
 * Organized into three categories:
 * 1. Purchase items (registrations/memberships) with fallback logic
 * 2. Discount codes (category-based lookups)
 * 3. System defaults (donations, stripe fees, etc.)
 */

import { createAdminClient } from './supabase/server'
import { logger } from './logging/logger'

const supabase = createAdminClient()

// =============================================================================
// CATEGORY 1: PURCHASE ITEMS (with fallback logic)
// =============================================================================

/**
 * Get accounting code for a registration
 * 1. Check registration_category.accounting_code first
 * 2. Fall back to registration.accounting_code from system_accounting_codes
 * 3. Return null if neither found
 */
export async function getRegistrationAccountingCode(
  registrationId: string, 
  categoryId: string
): Promise<string | null> {
  try {
    // Get registration category accounting code
    const { data: registrationCategory } = await supabase
      .from('registration_categories')
      .select('accounting_code')
      .eq('id', categoryId)
      .single()

    if (registrationCategory?.accounting_code) {
      return registrationCategory.accounting_code
    }

    // Fall back to registration default from system_accounting_codes
    const { data: registration } = await supabase
      .from('registrations')
      .select('accounting_code')
      .eq('id', registrationId)
      .single()

    return registration?.accounting_code || null

  } catch (error) {
    logger.logPaymentProcessing(
      'accounting-code-lookup-error',
      'Error looking up registration accounting code',
      { registrationId, categoryId, error: error instanceof Error ? error.message : String(error) },
      'error'
    )
    return null
  }
}

/**
 * Get accounting code for a membership
 * Similar logic to registrations
 */
export async function getMembershipAccountingCode(membershipId: string): Promise<string | null> {
  try {
    const { data: membership } = await supabase
      .from('memberships')
      .select('accounting_code')
      .eq('id', membershipId)
      .single()

    return membership?.accounting_code || null

  } catch (error) {
    logger.logPaymentProcessing(
      'accounting-code-lookup-error',
      'Error looking up membership accounting code',
      { membershipId, error: error instanceof Error ? error.message : String(error) },
      'error'
    )
    return null
  }
}

// =============================================================================
// CATEGORY 2: DISCOUNT CODES (category-based lookups)
// =============================================================================

/**
 * Get accounting code for a discount code
 * 1. Look up discount_codes table to find discount_category_id
 * 2. Get accounting_code from discount_categories table
 * 3. Return null if not found
 */
export async function getDiscountAccountingCode(discountCode: string): Promise<string | null> {
  try {
    const { data: discount } = await supabase
      .from('discount_codes')
      .select(`
        discount_category_id,
        discount_categories!inner (
          accounting_code
        )
      `)
      .eq('code', discountCode)
      .single()

    return (discount?.discount_categories as any)?.accounting_code || null

  } catch (error) {
    logger.logPaymentProcessing(
      'accounting-code-lookup-error',
      'Error looking up discount accounting code',
      { discountCode, error: error instanceof Error ? error.message : String(error) },
      'error'
    )
    return null
  }
}

// =============================================================================
// CATEGORY 3: SYSTEM DEFAULTS (direct lookups)
// =============================================================================

/**
 * Get accounting code for donations received
 */
export async function getDonationReceivedAccountingCode(): Promise<string | null> {
  return await getSystemAccountingCode('donation_received_default')
}

/**
 * Get accounting code for donations given
 */
export async function getDonationGivenAccountingCode(): Promise<string | null> {
  return await getSystemAccountingCode('donation_given_default')
}

/**
 * Get accounting code for Stripe fees
 */
export async function getStripeAccountingCode(): Promise<string | null> {
  return await getSystemAccountingCode('stripe_fees_default')
}

/**
 * Helper function to get system accounting codes
 */
async function getSystemAccountingCode(codeType: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('system_accounting_codes')
      .select('accounting_code')
      .eq('code_type', codeType)
      .single()

    return data?.accounting_code || null

  } catch (error) {
    logger.logPaymentProcessing(
      'accounting-code-lookup-error',
      'Error looking up system accounting code',
      { codeType, error: error instanceof Error ? error.message : String(error) },
      'error'
    )
    return null
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get all accounting codes for a registration with discount
 * Returns both the registration code and discount code if applicable
 */
export async function getRegistrationAccountingCodes(
  registrationId: string,
  categoryId: string,
  discountCode?: string
): Promise<{
  registration: string | null
  discount: string | null
}> {
  const [registrationCode, discountAccountingCode] = await Promise.all([
    getRegistrationAccountingCode(registrationId, categoryId),
    discountCode ? getDiscountAccountingCode(discountCode) : Promise.resolve(null)
  ])

  return {
    registration: registrationCode,
    discount: discountAccountingCode
  }
}

/**
 * Get accounting code with fallback to a default value
 * Useful when you need to guarantee a non-null accounting code
 */
export function withFallback(accountingCode: string | null, fallback: string): string {
  return accountingCode || fallback
}

/**
 * Get frequently used accounting codes across the system
 * Returns codes with their usage count, sorted by frequency (most used first)
 * Used for intelligent autocomplete sorting
 */
export async function getFrequentlyUsedAccountingCodes(): Promise<Array<{
  code: string
  count: number
}>> {
  try {
    // Fetch all accounting codes from different tables
    const [
      { data: memberships },
      { data: regCategories },
      { data: discountCategories },
      { data: systemCodes }
    ] = await Promise.all([
      supabase.from('memberships').select('accounting_code').not('accounting_code', 'is', null),
      supabase.from('registration_categories').select('accounting_code').not('accounting_code', 'is', null),
      supabase.from('discount_categories').select('accounting_code').not('accounting_code', 'is', null),
      supabase.from('system_accounting_codes').select('accounting_code').not('accounting_code', 'is', null)
    ])

    // Combine all codes
    const allCodes: string[] = [
      ...(memberships || []).map(m => m.accounting_code),
      ...(regCategories || []).map(r => r.accounting_code),
      ...(discountCategories || []).map(d => d.accounting_code),
      ...(systemCodes || []).map(s => s.accounting_code)
    ]

    // Count occurrences
    const codeCountMap = new Map<string, number>()
    allCodes.forEach(code => {
      codeCountMap.set(code, (codeCountMap.get(code) || 0) + 1)
    })

    // Convert to array and sort by count
    const result = Array.from(codeCountMap.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count) // Sort descending by count
      .slice(0, 10) // Return top 10 most used

    return result

  } catch (error) {
    logger.logPaymentProcessing(
      'frequently-used-codes-error',
      'Error fetching frequently used accounting codes',
      { error: error instanceof Error ? error.message : String(error) },
      'error'
    )
    return []
  }
}