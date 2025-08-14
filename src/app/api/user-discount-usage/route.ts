import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
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

    const isAdmin = currentUser?.is_admin || false

    // Get query parameters
    const url = new URL(request.url)
    const targetUserId = url.searchParams.get('userId')

    // Determine which user's data to fetch
    let userId = user.id
    if (isAdmin && targetUserId) {
      userId = targetUserId
    } else if (!isAdmin && targetUserId && targetUserId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get discount usage grouped by season and category for non-expired seasons
    const { data: discountUsage, error: usageError } = await supabase
      .from('discount_usage')
      .select(`
        amount_saved,
        seasons!inner (
          id,
          name,
          end_date
        ),
        discount_categories!inner (
          id,
          name
        )
      `)
      .eq('user_id', userId)
      .gte('seasons.end_date', new Date().toISOString().split('T')[0])
      .order('seasons.name', { ascending: false })
      .order('discount_categories.name', { ascending: true })

    if (usageError) {
      console.error('Error fetching discount usage:', usageError)
      return NextResponse.json({ error: 'Failed to fetch discount usage' }, { status: 500 })
    }

    // Group the data by season, then by category
    const groupedUsage: Record<string, Record<string, { amount: number, categoryId: string }>> = {}
    
    discountUsage?.forEach((usage: any) => {
      const seasonName = usage.seasons.name
      const categoryName = usage.discount_categories.name
      const categoryId = usage.discount_categories.id
      
      if (!groupedUsage[seasonName]) {
        groupedUsage[seasonName] = {}
      }
      
      if (!groupedUsage[seasonName][categoryName]) {
        groupedUsage[seasonName][categoryName] = { amount: 0, categoryId }
      }
      
      groupedUsage[seasonName][categoryName].amount += usage.amount_saved
    })

    // Convert to array format for easier frontend consumption
    const structuredUsage = Object.entries(groupedUsage).map(([seasonName, categories]) => ({
      seasonName,
      categories: Object.entries(categories).map(([categoryName, data]) => ({
        categoryName,
        categoryId: data.categoryId,
        totalAmount: data.amount
      })),
      totalAmount: Object.values(categories).reduce((sum, data) => sum + data.amount, 0)
    }))

    return NextResponse.json({
      success: true,
      userId,
      isAdmin,
      discountUsage: structuredUsage
    })

  } catch (error) {
    console.error('Error in user-discount-usage API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}