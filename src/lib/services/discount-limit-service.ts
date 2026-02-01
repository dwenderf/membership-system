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

export interface DiscountLimitResult {
  originalAmount: number
  finalAmount: number
  isPartialDiscount: boolean
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
 * @returns Result with final discount amount and partial discount info
 */
export async function checkSeasonalDiscountLimit(
  supabase: SupabaseClient,
  userId: string,
  discountCodeId: string,
  seasonId: string,
  requestedDiscountAmount: number
): Promise<DiscountLimitResult> {
  try {
    // Get discount code and category with seasonal limit
    const { data: discountCode, error: discountError } = await supabase
      .from('discount_codes')
      .select(`
        *,
        category:discount_categories(
          id,
          name,
          max_discount_per_user_per_season
        )
      `)
      .eq('id', discountCodeId)
      .single()

    if (discountError || !discountCode) {
      throw new Error('Discount code not found')
    }

    // If no seasonal limit is set, allow full discount
    const maxAllowed = discountCode.category?.max_discount_per_user_per_season
    if (!maxAllowed || maxAllowed <= 0) {
      return {
        originalAmount: requestedDiscountAmount,
        finalAmount: requestedDiscountAmount,
        isPartialDiscount: false
      }
    }

    // Calculate current seasonal usage
    const totalUsed = await calculateSeasonalDiscountUsage(
      supabase,
      userId,
      discountCode.category.id,
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
          categoryId: discountCode.category.id,
          categoryName: discountCode.category.name,
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
        partialDiscountMessage: `You have already reached your $${(maxAllowed / 100).toFixed(2)} season limit for ${discountCode.category.name} discounts.`,
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
          categoryId: discountCode.category.id,
          categoryName: discountCode.category.name,
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
        partialDiscountMessage: `Applied $${(remaining / 100).toFixed(2)} discount (you have $${(remaining / 100).toFixed(2)} remaining of your $${(maxAllowed / 100).toFixed(2)} ${discountCode.category.name} season limit). You have already used $${(totalUsed / 100).toFixed(2)} in discounts this season.`,
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
