import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: currentUser } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!currentUser?.is_admin) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    // Get discount usage with all related data from computed view
    const { data: discountUsage, error: usageError } = await adminSupabase
      .from('discount_usage_computed')
      .select(`
        id,
        user_id,
        user_first_name,
        user_last_name,
        user_email,
        user_member_id,
        amount_saved,
        used_at,
        season_id,
        season_name,
        season_start_date,
        season_end_date,
        discount_category_id,
        discount_category_name,
        discount_category_max_per_season,
        discount_code_id,
        discount_code
      `)
      .order('used_at', { ascending: false })

    if (usageError) {
      console.error('Error fetching discount usage:', usageError)
      return NextResponse.json({ error: 'Failed to fetch discount usage' }, { status: 500 })
    }

    // Group the data by Season -> Category -> User -> Discount Code
    interface DiscountCodeUsage {
      code: string
      codeId: string
      amount: number
      date: string
    }

    interface UserUsage {
      userId: string
      userName: string
      userEmail: string
      memberId: string | null
      totalAmount: number
      remaining: number | null
      isFullyUtilized: boolean
      discountCodes: DiscountCodeUsage[]
    }

    interface CategoryUsage {
      categoryId: string
      categoryName: string
      totalAmount: number
      maxPerUser: number | null
      users: UserUsage[]
    }

    interface SeasonUsage {
      seasonId: string
      seasonName: string
      startDate: string
      endDate: string
      totalAmount: number
      categories: CategoryUsage[]
    }

    const seasonMap = new Map<string, SeasonUsage>()

    discountUsage?.forEach((usage: any) => {
      const seasonId = usage.season_id
      const seasonName = usage.season_name
      const seasonStartDate = usage.season_start_date
      const seasonEndDate = usage.season_end_date
      const categoryId = usage.discount_category_id
      const categoryName = usage.discount_category_name
      const maxPerUser = usage.discount_category_max_per_season
      const userId = usage.user_id
      const userName = `${usage.user_first_name || ''} ${usage.user_last_name || ''}`.trim() || 'Unknown'
      const userEmail = usage.user_email
      const memberId = usage.user_member_id
      const codeId = usage.discount_code_id
      const code = usage.discount_code
      const amount = usage.amount_saved
      const date = usage.used_at

      // Get or create season
      if (!seasonMap.has(seasonId)) {
        seasonMap.set(seasonId, {
          seasonId,
          seasonName,
          startDate: seasonStartDate,
          endDate: seasonEndDate,
          totalAmount: 0,
          categories: []
        })
      }
      const season = seasonMap.get(seasonId)!

      // Get or create category within season
      let category = season.categories.find(c => c.categoryId === categoryId)
      if (!category) {
        category = {
          categoryId,
          categoryName,
          totalAmount: 0,
          maxPerUser,
          users: []
        }
        season.categories.push(category)
      }

      // Get or create user within category
      let userUsage = category.users.find(u => u.userId === userId)
      if (!userUsage) {
        userUsage = {
          userId,
          userName,
          userEmail,
          memberId,
          totalAmount: 0,
          remaining: null,
          isFullyUtilized: false,
          discountCodes: []
        }
        category.users.push(userUsage)
      }

      // Add discount code usage
      let codeUsage = userUsage.discountCodes.find(c => c.codeId === codeId && c.date === date)
      if (!codeUsage) {
        codeUsage = {
          code,
          codeId,
          amount: 0,
          date
        }
        userUsage.discountCodes.push(codeUsage)
      }

      // Update amounts
      codeUsage.amount += amount
      userUsage.totalAmount += amount
      category.totalAmount += amount
      season.totalAmount += amount
    })

    // Calculate remaining amounts and fully utilized status
    seasonMap.forEach(season => {
      season.categories.forEach(category => {
        category.users.forEach(user => {
          if (category.maxPerUser !== null) {
            user.remaining = Math.max(0, category.maxPerUser - user.totalAmount)
            user.isFullyUtilized = user.totalAmount >= category.maxPerUser
          }

          // Sort discount codes by date (most recent first)
          user.discountCodes.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        })

        // Sort users by total amount (highest first)
        category.users.sort((a, b) => b.totalAmount - a.totalAmount)
      })

      // Sort categories by total amount (highest first)
      season.categories.sort((a, b) => b.totalAmount - a.totalAmount)
    })

    // Convert map to array and sort by season (most recent first)
    const seasons = Array.from(seasonMap.values())
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())

    return NextResponse.json({
      success: true,
      seasons
    })

  } catch (error) {
    console.error('Error in discount-usage API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
