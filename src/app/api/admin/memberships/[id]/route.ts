import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// PUT /api/admin/memberships/[id] - Update a specific membership
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
    const { name, description, accounting_code, price_monthly, price_annual, allow_discounts, allow_monthly } = body
    
    // Validate required fields
    if (!name?.trim()) {
      return NextResponse.json({ 
        error: 'Membership name is required' 
      }, { status: 400 })
    }

    if (!accounting_code?.trim()) {
      return NextResponse.json({ 
        error: 'Accounting code is required' 
      }, { status: 400 })
    }

    if (typeof price_monthly !== 'number' || price_monthly < 0) {
      return NextResponse.json({ 
        error: 'Monthly price must be 0 or greater' 
      }, { status: 400 })
    }

    if (typeof price_annual !== 'number' || price_annual < 0) {
      return NextResponse.json({ 
        error: 'Annual price must be 0 or greater' 
      }, { status: 400 })
    }

    // Basic validation - ensure annual pricing offers some discount when monthly is available
    if (allow_monthly && price_monthly > 0 && price_annual >= (price_monthly * 12)) {
      return NextResponse.json({ 
        error: 'Annual price should be less than 12 times the monthly price' 
      }, { status: 400 })
    }

    // Update the membership
    const { data: membership, error } = await supabase
      .from('memberships')
      .update({
        name: name.trim(),
        description: description?.trim() || null,
        accounting_code: accounting_code.trim(),
        price_monthly,
        price_annual,
        allow_discounts: allow_discounts || false,
        allow_monthly: allow_monthly !== undefined ? allow_monthly : true
      })
      .eq('id', params.id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        if (error.message.includes('name')) {
          return NextResponse.json({ error: 'Membership name already exists' }, { status: 400 })
        }
      }
      console.error('Error updating membership:', error)
      return NextResponse.json({ error: 'Failed to update membership' }, { status: 500 })
    }

    if (!membership) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
    }

    return NextResponse.json({ membership })
    
  } catch (error) {
    console.error('Error in membership update API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}