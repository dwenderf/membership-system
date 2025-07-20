import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/admin/discount-categories - List all discount categories
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (userError || !userData?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Get all discount categories with code counts
    const { data: categories, error } = await supabase
      .from('discount_categories')
      .select(`
        *,
        discount_codes (count)
      `)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching discount categories:', error)
      return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
    }

    return NextResponse.json({ categories })
    
  } catch (error) {
    console.error('Error in discount categories API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/admin/discount-categories - Create new discount category
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (userError || !userData?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { name, accounting_code, max_discount_per_user_per_season, description } = body
    
    // Validate required fields
    if (!name || !accounting_code) {
      return NextResponse.json({ 
        error: 'Missing required fields: name, accounting_code' 
      }, { status: 400 })
    }

    // Validate max_discount if provided
    if (max_discount_per_user_per_season !== null && max_discount_per_user_per_season !== undefined) {
      if (typeof max_discount_per_user_per_season !== 'number' || max_discount_per_user_per_season <= 0) {
        return NextResponse.json({ 
          error: 'max_discount_per_user_per_season must be a positive number in cents' 
        }, { status: 400 })
      }
    }

    // Create the category
    const { data: category, error } = await supabase
      .from('discount_categories')
      .insert({
        name: name.trim(),
        accounting_code: accounting_code.trim().toUpperCase(),
        max_discount_per_user_per_season,
        description: description?.trim() || null
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        if (error.message.includes('name')) {
          return NextResponse.json({ error: 'Category name already exists' }, { status: 400 })
        }
        if (error.message.includes('accounting_code')) {
          return NextResponse.json({ error: 'Accounting code already exists' }, { status: 400 })
        }
      }
      console.error('Error creating discount category:', error)
      return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
    }

    return NextResponse.json({ category }, { status: 201 })
    
  } catch (error) {
    console.error('Error in discount categories API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}