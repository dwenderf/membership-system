import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getSingleCategoryRegistrationCount } from '@/lib/registration-counts'

/**
 * GET /api/admin/registrations/[id]/categories
 *
 * Returns all categories for a registration with current counts
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()

  try {
    const { id } = await params
    // Check admin authorization
    const { data: { user: authUser } } = await supabase.auth.getUser()

    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: currentUser } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()

    if (!currentUser?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get categories for this registration
    const { data: categories, error: catError } = await supabase
      .from('registration_categories')
      .select(`
        id,
        price,
        max_capacity,
        custom_name,
        category_id,
        categories (
          name
        )
      `)
      .eq('registration_id', id)
      .order('sort_order', { ascending: true })

    if (catError) {
      return NextResponse.json({
        error: 'Failed to fetch categories'
      }, { status: 500 })
    }

    // Get current counts for each category
    const categoriesWithCounts = await Promise.all(
      (categories || []).map(async (cat) => {
        const count = await getSingleCategoryRegistrationCount(cat.id)
        const category = Array.isArray(cat.categories) ? cat.categories[0] : cat.categories
        return {
          id: cat.id,
          name: category?.name || cat.custom_name,
          price: cat.price,
          maxCapacity: cat.max_capacity,
          currentCount: count,
          category_id: cat.category_id
        }
      })
    )

    return NextResponse.json({
      categories: categoriesWithCounts
    })

  } catch (error) {
    return NextResponse.json({
      error: 'Internal server error'
    }, { status: 500 })
  }
}
