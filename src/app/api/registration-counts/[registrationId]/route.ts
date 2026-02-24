import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCategoryRegistrationCounts } from '@/lib/registration-counts'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ registrationId: string }> }
) {
  try {
    const { registrationId } = await params
    const supabase = await createClient()

    // Get all categories for this registration
    const { data: categories, error: categoriesError } = await supabase
      .from('registration_categories')
      .select('id, max_capacity')
      .eq('registration_id', registrationId)

    if (categoriesError) {
      return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
    }

    if (!categories || categories.length === 0) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    // Get current counts for all categories
    const categoryIds = categories.map(c => c.id)
    const counts = await getCategoryRegistrationCounts(categoryIds)

    // Build response with capacity info
    const result: Record<string, {
      current: number
      capacity: number | null
      available: number | null
      isFull: boolean
    }> = {}

    for (const category of categories) {
      const current = counts[category.id] || 0
      const capacity = category.max_capacity
      const available = capacity ? Math.max(0, capacity - current) : null
      const isFull = capacity ? current >= capacity : false

      result[category.id] = {
        current,
        capacity,
        available,
        isFull
      }
    }

    return NextResponse.json(result)
    
  } catch (error) {
    console.error('Error fetching registration counts:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}