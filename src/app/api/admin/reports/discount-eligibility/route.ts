import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import {
  resolveEffectiveDiscountLimitsBatch,
  calculateSeasonalDiscountUsageBatch
} from '@/lib/services/discount-limit-service'

/**
 * GET /api/admin/reports/discount-eligibility
 * Returns per-user discount allowances and eligibility for a season
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // 1. Authenticate & Admin Check
    const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser()
    if (authError || !currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userProfile } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', currentUser.id)
      .single()

    if (!userProfile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    // 2. Determine target seasonId
    const { searchParams } = new URL(request.url)
    let seasonId = searchParams.get('seasonId')

    const nowIso = new Date().toISOString()

    // Fetch all active & upcoming seasons for dropdown
    const { data: seasons } = await supabase
      .from('seasons')
      .select('id, name, start_date, end_date')
      .order('start_date', { ascending: false })

    if (!seasonId) {
      // Default to current season (end_date >= now) or most recent
      const currentSeason = seasons?.find(s => new Date(s.start_date) <= new Date() && new Date(s.end_date) >= new Date())
        || seasons?.[0]
      seasonId = currentSeason?.id || null
    }

    if (!seasonId) {
      return NextResponse.json({
        seasons: seasons || [],
        selectedSeasonId: null,
        eligibility: []
      })
    }

    // 3. Query user_discount_allowances joined with users and categories for season
    const { data: allowances, error: allowancesError } = await supabase
      .from('user_discount_allowances')
      .select(`
        id,
        user_id,
        discount_category_id,
        season_id,
        discount_percentage,
        max_discount_amount,
        notes,
        created_at,
        updated_at,
        user:users(id, first_name, last_name, email, member_id),
        category:discount_categories(id, name, requires_user_allowance)
      `)
      .eq('season_id', seasonId)

    if (allowancesError) {
      return NextResponse.json({ error: 'Failed to fetch discount allowances' }, { status: 500 })
    }

    const allowanceRows = allowances || []
    const userIds = Array.from(new Set(allowanceRows.map(a => a.user_id)))

    // 4. Batch resolve effective limits & usage
    const effectiveLimitsMap = await resolveEffectiveDiscountLimitsBatch(supabase, userIds, seasonId)
    const usageMap = await calculateSeasonalDiscountUsageBatch(supabase, userIds, seasonId)

    // 5. Format report rows (including users with 0 usage)
    const eligibility = allowanceRows.map(allowance => {
      const user = Array.isArray(allowance.user) ? allowance.user[0] : allowance.user
      const category = Array.isArray(allowance.category) ? allowance.category[0] : allowance.category
      const key = `${allowance.user_id}:${allowance.discount_category_id}`

      const effectiveLimit = effectiveLimitsMap.get(key)
      const totalUsed = usageMap.get(key) || 0 // Missing map key = 0 usage

      const isRevoked = allowance.max_discount_amount === 0 || effectiveLimit?.isEligible === false
      const source = isRevoked ? 'denied' : 'user_allowance'
      const maxAllowed = effectiveLimit?.maxAllowed ?? allowance.max_discount_amount
      const remaining = !isRevoked && maxAllowed !== null ? Math.max(0, maxAllowed - totalUsed) : (!isRevoked ? null : 0)

      return {
        allowanceId: allowance.id,
        userId: allowance.user_id,
        userName: `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Unknown User',
        userEmail: user?.email || '',
        memberId: user?.member_id || null,
        categoryId: allowance.discount_category_id,
        categoryName: category?.name || 'Category',
        discountPercentage: allowance.discount_percentage,
        maxDiscountAmount: allowance.max_discount_amount,
        effectiveMaxAllowed: maxAllowed,
        totalUsed,
        remaining,
        isRevoked,
        source, // 'user_allowance' | 'denied'
        notes: allowance.notes,
        updatedAt: allowance.updated_at
      }
    })

    // Sort by user name
    eligibility.sort((a, b) => a.userName.localeCompare(b.userName))

    return NextResponse.json({
      seasons: seasons || [],
      selectedSeasonId: seasonId,
      eligibility
    })
  } catch (error) {
    console.error('Error fetching discount eligibility report:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
