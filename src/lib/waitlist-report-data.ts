import { SupabaseClient } from '@supabase/supabase-js'
import { userHasValidPaymentMethod } from '@/lib/payment-method-utils'

export interface WaitlistReportEntry {
  id: string
  user_id: string
  first_name: string
  last_name: string
  email: string
  category_name: string
  category_id: string
  position: number
  joined_at: string
  is_lgbtq: boolean | null
  is_goalie: boolean
  hasValidPaymentMethod: boolean
  discount_code_id: string | null
  discount_code: string | null
  discount_percentage: number | null
  base_price: number
  discount_amount: number
  final_amount: number
}

/**
 * Fetches and enriches active waitlist entries for a registration — position,
 * payment-method readiness, and discount pricing (with seasonal cap
 * enforcement) — for the roster report pages. Shared by the admin and captain
 * roster APIs so the "Select from waitlist" pricing logic isn't duplicated a
 * third time.
 */
export async function fetchWaitlistReportData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminSupabase: SupabaseClient<any>,
  registrationId: string
): Promise<WaitlistReportEntry[]> {
  const { data: registrationInfo } = await adminSupabase
    .from('registrations')
    .select('season_id')
    .eq('id', registrationId)
    .single()

  const registrationSeasonId = registrationInfo?.season_id

  const { data: waitlistData, error: waitlistError } = await adminSupabase
    .from('waitlists')
    .select(`
      *,
      users!waitlists_user_id_fkey (
        id,
        email,
        first_name,
        last_name,
        is_lgbtq,
        is_goalie,
        stripe_payment_method_id,
        setup_intent_status
      ),
      registration_categories (
        id,
        custom_name,
        price,
        categories (
          name
        )
      ),
      discount_codes (
        id,
        code,
        percentage,
        category:discount_categories (
          id,
          name,
          max_discount_per_user_per_season
        )
      )
    `)
    .eq('registration_id', registrationId)
    .is('removed_at', null)
    .order('position', { ascending: true })

  if (waitlistError) {
    console.error('fetchWaitlistReportData: error fetching waitlist data', { error: waitlistError, registrationId })
    return []
  }

  // Get discount usage for waitlist users to check seasonal limits.
  // IMPORTANT: Filter by season_id to only count usage for THIS season.
  const waitlistUserIds = waitlistData?.map(w => {
    const user = Array.isArray(w.users) ? w.users[0] : w.users
    return user?.id
  }).filter(Boolean) || []

  let discountUsageQuery = adminSupabase
    .from('discount_usage_computed')
    .select('user_id, discount_category_id, amount_saved')
    .in('user_id', waitlistUserIds)

  if (registrationSeasonId) {
    discountUsageQuery = discountUsageQuery.eq('season_id', registrationSeasonId)
  }

  const { data: discountUsageData } = await discountUsageQuery

  const usageByUserAndCategory = new Map<string, number>()
  discountUsageData?.forEach(usage => {
    const key = `${usage.user_id}-${usage.discount_category_id}`
    const current = usageByUserAndCategory.get(key) || 0
    usageByUserAndCategory.set(key, current + usage.amount_saved)
  })

  return waitlistData?.map(item => {
    const user = Array.isArray(item.users) ? item.users[0] : item.users
    const registrationCategory = Array.isArray(item.registration_categories) ? item.registration_categories[0] : item.registration_categories
    const category = registrationCategory?.categories ? (Array.isArray(registrationCategory.categories) ? registrationCategory.categories[0] : registrationCategory.categories) : null
    const discountCode = Array.isArray(item.discount_codes) ? item.discount_codes[0] : item.discount_codes

    // Calculate pricing with seasonal cap enforcement
    const basePrice = registrationCategory?.price || 0
    let discountAmount = 0

    if (discountCode) {
      const requestedDiscountAmount = Math.round((basePrice * discountCode.percentage) / 100)

      const discountCategory = Array.isArray(discountCode.category) ? discountCode.category[0] : discountCode.category
      if (discountCategory && discountCategory.max_discount_per_user_per_season) {
        const usageKey = `${user?.id}-${discountCategory.id}`
        const currentUsage = usageByUserAndCategory.get(usageKey) || 0
        const limit = discountCategory.max_discount_per_user_per_season
        const remainingAmount = Math.max(0, limit - currentUsage)

        discountAmount = currentUsage + requestedDiscountAmount > limit
          ? remainingAmount
          : requestedDiscountAmount
      } else {
        discountAmount = requestedDiscountAmount
      }
    }

    const finalAmount = Math.max(0, basePrice - discountAmount)
    const hasValidPaymentMethod = userHasValidPaymentMethod(user)

    return {
      id: item.id,
      user_id: user?.id || 'Unknown',
      first_name: user?.first_name || '',
      last_name: user?.last_name || '',
      email: user?.email || 'Unknown',
      category_name: category?.name || registrationCategory?.custom_name || 'Unknown Category',
      category_id: item.registration_category_id,
      position: item.position,
      joined_at: item.joined_at,
      is_lgbtq: user?.is_lgbtq,
      is_goalie: user?.is_goalie || false,
      hasValidPaymentMethod,
      discount_code_id: discountCode?.id || null,
      discount_code: discountCode?.code || null,
      discount_percentage: discountCode?.percentage || null,
      base_price: basePrice,
      discount_amount: discountAmount,
      final_amount: finalAmount
    }
  }) || []
}
