import { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logging/logger'

/**
 * Service for enforcing seasonal discount limits across all payment flows
 *
 * This ensures consistent enforcement of max_discount_per_user_per_season
 * across regular registration, alternate selection, and waitlist payments.
 *
 * Uses discount_usage_computed view which derives data from xero_invoice_line_items
 * as the single source of truth.
 */

export interface SeasonalDiscountUsage {
  totalUsed: number
  remaining: number
  maxAllowed: number
}

export interface DiscountCategoryInfo {
  id: string
  name: string
  max_discount_per_user_per_season?: number | null
}

export interface DiscountCodeWithCategory {
  id: string
  code: string
  percentage: number
  category: DiscountCategoryInfo | null
}

export interface CheckSeasonalDiscountLimitOptions {
  isRefund?: boolean
  discountCode?: DiscountCodeWithCategory
}

export interface SeasonalDiscountUsageStatus {
  currentUsage: number
  limit: number
  wouldExceed: boolean
  remainingAmount: number
  requestedAmount: number
  appliedAmount: number
}

export interface DiscountLimitResult {
  originalAmount: number
  finalAmount: number
  isPartialDiscount: boolean
  isAtLimit?: boolean
  partialDiscountMessage?: string
  seasonalUsage?: SeasonalDiscountUsage
}

/**
 * Calculate total seasonal discount usage for a user and discount category
 *
 * @param supabase - Supabase client (use createClient() for user context, createAdminClient() for admin context)
 * @param userId - User ID to check
 * @param categoryId - Discount category ID
 * @param seasonId - Season ID
 * @returns Total amount of discounts used in the season for this category
 */
export async function calculateSeasonalDiscountUsage(
  supabase: SupabaseClient,
  userId: string,
  categoryId: string,
  seasonId: string
): Promise<number> {
  const { data: usageRecords, error } = await supabase
    .from('discount_usage_computed')
    .select('amount_saved')
    .eq('user_id', userId)
    .eq('discount_category_id', categoryId)
    .eq('season_id', seasonId)

  if (error) {
    logger.logPaymentProcessing(
      'seasonal-discount-usage-query-failed',
      'Failed to query seasonal discount usage',
      {
        userId,
        categoryId,
        seasonId,
        error: error.message
      },
      'error'
    )
    throw new Error(`Failed to query seasonal discount usage: ${error.message}`)
  }

  return usageRecords?.reduce((sum, record) => sum + (record.amount_saved || 0), 0) || 0
}

/**
 * Calculate seasonal discount usage in batch for multiple users within a season
 *
 * @param supabase - Supabase client
 * @param userIds - Array of user IDs
 * @param seasonId - Season ID
 * @returns Map of `${userId}:${categoryId}` to total discount amount used
 */
export async function calculateSeasonalDiscountUsageBatch(
  supabase: SupabaseClient,
  userIds: string[],
  seasonId: string
): Promise<Map<string, number>> {
  const usageMap = new Map<string, number>()

  if (!userIds || userIds.length === 0) {
    return usageMap
  }

  if (!seasonId) {
    throw new Error('Season ID is required for batch seasonal discount usage calculation')
  }

  const { data: discountUsage, error } = await supabase
    .from('discount_usage_computed')
    .select('user_id, discount_category_id, amount_saved')
    .in('user_id', userIds)
    .eq('season_id', seasonId)

  if (error) {
    logger.logPaymentProcessing(
      'seasonal-discount-usage-batch-query-failed',
      'Failed to query batch seasonal discount usage',
      {
        userIdCount: userIds.length,
        seasonId,
        error: error.message
      },
      'error'
    )
    throw new Error(`Failed to query batch seasonal discount usage: ${error.message}`)
  }

  discountUsage?.forEach(usage => {
    const key = `${usage.user_id}:${usage.discount_category_id}`
    const current = usageMap.get(key) || 0
    usageMap.set(key, current + (usage.amount_saved || 0))
  })

  return usageMap
}

/**
 * Evaluate seasonal discount limit for a category and given usage
 * Helper function for list displays (e.g. Site C alternates) to avoid inline cap arithmetic
 *
 * @param category - Category metadata
 * @param currentUsage - Current usage amount (in cents)
 * @param requestedDiscountAmount - Requested discount amount (in cents)
 * @returns Calculation result with isOverLimit, discountAmount, and usageStatus
 */
export function evaluateSeasonalDiscountLimit(
  category: DiscountCategoryInfo | null | undefined,
  currentUsage: number,
  requestedDiscountAmount: number
): {
  isOverLimit: boolean
  discountAmount: number
  usageStatus: SeasonalDiscountUsageStatus | null
} {
  // 0 means unlimited here, preserving legacy category semantics. This is NOT the allowance convention — see Phase 2, where 0 means ineligible. Do not reuse this check for allowance resolution.
  const limit = category?.max_discount_per_user_per_season
  if (!limit || limit <= 0) {
    return {
      isOverLimit: false,
      discountAmount: requestedDiscountAmount,
      usageStatus: null
    }
  }

  const remainingAmount = Math.max(0, limit - currentUsage)
  const isOverLimit = (currentUsage + requestedDiscountAmount) > limit
  const discountAmount = isOverLimit ? remainingAmount : requestedDiscountAmount

  const usageStatus: SeasonalDiscountUsageStatus = {
    currentUsage,
    limit,
    wouldExceed: isOverLimit,
    remainingAmount,
    requestedAmount: requestedDiscountAmount,
    appliedAmount: discountAmount
  }

  return {
    isOverLimit,
    discountAmount,
    usageStatus
  }
}

/**
 * Check seasonal discount limit and apply partial discount if needed
 *
 * This is the core function that enforces max_discount_per_user_per_season.
 * If the user has already reached their seasonal limit, no discount is applied.
 * If applying the full discount would exceed the limit, a partial discount is applied.
 *
 * @param supabase - Supabase client (use createClient() for user context, createAdminClient() for admin context)
 * @param userId - User ID to check
 * @param discountCodeId - Discount code ID
 * @param seasonId - Season ID
 * @param requestedDiscountAmount - The discount amount being requested (in cents)
 * @param options - Optional refund flag or pre-fetched discount code
 * @returns Result with final discount amount and partial discount info
 */
export async function checkSeasonalDiscountLimit(
  supabase: SupabaseClient,
  userId: string,
  discountCodeId: string,
  seasonId: string,
  requestedDiscountAmount: number,
  options?: CheckSeasonalDiscountLimitOptions
): Promise<DiscountLimitResult> {
  try {
    // If refund flow, bypass cap enforcement entirely
    if (options?.isRefund) {
      return {
        originalAmount: requestedDiscountAmount,
        finalAmount: requestedDiscountAmount,
        isPartialDiscount: false,
        isAtLimit: false
      }
    }

    let discountCode = options?.discountCode
    let category: DiscountCategoryInfo | null | undefined = discountCode?.category

    // If pre-fetched code wasn't supplied, fetch discount code and category from DB
    if (!discountCode) {
      const { data: fetchedCode, error: discountError } = await supabase
        .from('discount_codes')
        .select(`
          id,
          code,
          percentage,
          category:discount_categories(
            id,
            name,
            max_discount_per_user_per_season
          )
        `)
        .eq('id', discountCodeId)
        .single()

      if (discountError || !fetchedCode) {
        throw new Error('Discount code not found')
      }

      discountCode = {
        id: fetchedCode.id,
        code: fetchedCode.code,
        percentage: fetchedCode.percentage,
        category: Array.isArray(fetchedCode.category) ? fetchedCode.category[0] : fetchedCode.category
      }
      category = discountCode.category
    }

    // 0 means unlimited here, preserving legacy category semantics. This is NOT the allowance convention — see Phase 2, where 0 means ineligible. Do not reuse this check for allowance resolution.
    const maxAllowed = category?.max_discount_per_user_per_season
    if (!category || !category.id || !maxAllowed || maxAllowed <= 0) {
      return {
        originalAmount: requestedDiscountAmount,
        finalAmount: requestedDiscountAmount,
        isPartialDiscount: false,
        isAtLimit: false
      }
    }

    // Calculate current seasonal usage
    const totalUsed = await calculateSeasonalDiscountUsage(
      supabase,
      userId,
      category.id,
      seasonId
    )

    const remaining = Math.max(0, maxAllowed - totalUsed)

    // Check if user has already reached their seasonal limit
    if (totalUsed >= maxAllowed) {
      logger.logPaymentProcessing(
        'seasonal-discount-limit-reached',
        'User has reached seasonal discount limit',
        {
          userId,
          discountCodeId,
          categoryId: category.id,
          categoryName: category.name,
          seasonId,
          totalUsed,
          maxAllowed,
          requestedAmount: requestedDiscountAmount
        },
        'info'
      )

      return {
        originalAmount: requestedDiscountAmount,
        finalAmount: 0,
        isPartialDiscount: false,
        isAtLimit: true,
        partialDiscountMessage: `You have already reached your $${(maxAllowed / 100).toFixed(2)} season limit for ${category.name} discounts.`,
        seasonalUsage: {
          totalUsed,
          remaining: 0,
          maxAllowed
        }
      }
    }

    // Check if applying full discount would exceed limit
    if (totalUsed + requestedDiscountAmount > maxAllowed) {
      logger.logPaymentProcessing(
        'seasonal-discount-partial-applied',
        'Applied partial discount due to seasonal limit',
        {
          userId,
          discountCodeId,
          categoryId: category.id,
          categoryName: category.name,
          seasonId,
          totalUsed,
          maxAllowed,
          remaining,
          requestedAmount: requestedDiscountAmount,
          appliedAmount: remaining
        },
        'info'
      )

      return {
        originalAmount: requestedDiscountAmount,
        finalAmount: remaining,
        isPartialDiscount: true,
        isAtLimit: false,
        // Note: Site B (validate-discount-code route) constructs its own UX message for checkout. Changes to this string will not alter Site B's response.
        partialDiscountMessage: `Applied $${(remaining / 100).toFixed(2)} discount (you have $${(remaining / 100).toFixed(2)} remaining of your $${(maxAllowed / 100).toFixed(2)} ${category.name} season limit). You have already used $${(totalUsed / 100).toFixed(2)} in discounts this season.`,
        seasonalUsage: {
          totalUsed,
          remaining,
          maxAllowed
        }
      }
    }

    // Full discount can be applied
    return {
      originalAmount: requestedDiscountAmount,
      finalAmount: requestedDiscountAmount,
      isPartialDiscount: false,
      isAtLimit: false,
      seasonalUsage: {
        totalUsed,
        remaining,
        maxAllowed
      }
    }
  } catch (error) {
    logger.logPaymentProcessing(
      'seasonal-discount-limit-check-failed',
      'Failed to check seasonal discount limit',
      {
        userId,
        discountCodeId,
        seasonId,
        requestedDiscountAmount,
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )
    throw error
  }
}

/**
 * Get seasonal discount usage summary for display purposes
 * (e.g., admin viewing user's discount status)
 *
 * @param supabase - Supabase client (typically createAdminClient() for admin views)
 * @param userId - User ID to check
 * @param categoryId - Discount category ID
 * @param seasonId - Season ID
 * @returns Seasonal usage summary
 */
export async function getSeasonalDiscountUsageSummary(
  supabase: SupabaseClient,
  userId: string,
  categoryId: string,
  seasonId: string
): Promise<SeasonalDiscountUsage | null> {
  try {
    // Get category with seasonal limit
    const { data: category, error: categoryError } = await supabase
      .from('discount_categories')
      .select('max_discount_per_user_per_season')
      .eq('id', categoryId)
      .single()

    if (categoryError || !category) {
      return null
    }

    const maxAllowed = category.max_discount_per_user_per_season || 0
    if (maxAllowed <= 0) {
      return null // No seasonal limit set
    }

    const totalUsed = await calculateSeasonalDiscountUsage(
      supabase,
      userId,
      categoryId,
      seasonId
    )

    const remaining = Math.max(0, maxAllowed - totalUsed)

    return {
      totalUsed,
      remaining,
      maxAllowed
    }
  } catch (error) {
    logger.logPaymentProcessing(
      'seasonal-discount-usage-summary-failed',
      'Failed to get seasonal discount usage summary',
      {
        userId,
        categoryId,
        seasonId,
        error: error instanceof Error ? error.message : String(error)
      },
      'warn'
    )
    return null
  }
}
