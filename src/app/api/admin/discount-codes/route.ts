import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/admin/discount-codes - List all discount codes with category info
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

    const { searchParams } = new URL(request.url)
    const categoryId = searchParams.get('category_id')

    let query = supabase
      .from('discount_codes')
      .select(`
        *,
        discount_categories (
          id,
          name,
          accounting_code,
          max_discount_per_user_per_season
        )
      `)
      .order('created_at', { ascending: false })

    // Filter by category if specified
    if (categoryId) {
      query = query.eq('discount_category_id', categoryId)
    }

    const { data: codes, error } = await query

    if (error) {
      console.error('Error fetching discount codes:', error)
      return NextResponse.json({ error: 'Failed to fetch discount codes' }, { status: 500 })
    }

    return NextResponse.json({ codes })
    
  } catch (error) {
    console.error('Error in discount codes API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/admin/discount-codes - Create new discount code
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
    const { 
      discount_category_id, 
      code, 
      percentage, 
      valid_from, 
      valid_until,
      is_active = true 
    } = body
    
    // Validate required fields
    if (!discount_category_id || !code || percentage === undefined) {
      return NextResponse.json({ 
        error: 'Missing required fields: discount_category_id, code, percentage' 
      }, { status: 400 })
    }

    // Validate percentage
    if (typeof percentage !== 'number' || percentage <= 0 || percentage > 100) {
      return NextResponse.json({ 
        error: 'Percentage must be a number between 1 and 100' 
      }, { status: 400 })
    }

    // Validate dates if provided
    if (valid_from && valid_until) {
      const fromDate = new Date(valid_from)
      const untilDate = new Date(valid_until)
      if (fromDate >= untilDate) {
        return NextResponse.json({ 
          error: 'valid_from must be before valid_until' 
        }, { status: 400 })
      }
    }

    // Verify category exists
    const { data: category, error: categoryError } = await supabase
      .from('discount_categories')
      .select('id, name')
      .eq('id', discount_category_id)
      .single()

    if (categoryError || !category) {
      return NextResponse.json({ error: 'Invalid discount category' }, { status: 400 })
    }

    // Create the discount code
    const { data: discountCode, error } = await supabase
      .from('discount_codes')
      .insert({
        discount_category_id,
        code: code.trim().toUpperCase(),
        percentage: parseFloat(percentage.toFixed(2)),
        is_active,
        valid_from: valid_from || null,
        valid_until: valid_until || null
      })
      .select(`
        *,
        discount_categories (
          id,
          name,
          accounting_code,
          max_discount_per_user_per_season
        )
      `)
      .single()

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return NextResponse.json({ error: 'Discount code already exists' }, { status: 400 })
      }
      console.error('Error creating discount code:', error)
      return NextResponse.json({ error: 'Failed to create discount code' }, { status: 500 })
    }

    return NextResponse.json({ code: discountCode }, { status: 201 })
    
  } catch (error) {
    console.error('Error in discount codes API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}