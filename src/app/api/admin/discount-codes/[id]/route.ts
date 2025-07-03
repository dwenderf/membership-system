import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/admin/discount-codes/[id] - Get specific discount code
export async function GET(
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

    const { data: code, error } = await supabase
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
      .eq('id', params.id)
      .single()

    if (error || !code) {
      return NextResponse.json({ error: 'Discount code not found' }, { status: 404 })
    }

    return NextResponse.json({ code })
    
  } catch (error) {
    console.error('Error fetching discount code:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/admin/discount-codes/[id] - Update discount code
export async function PATCH(
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
    const updates: any = {}

    // Validate and prepare updates
    if (body.code !== undefined) {
      updates.code = body.code.trim().toUpperCase()
    }

    if (body.percentage !== undefined) {
      if (typeof body.percentage !== 'number' || body.percentage <= 0 || body.percentage > 100) {
        return NextResponse.json({ 
          error: 'Percentage must be a number between 1 and 100' 
        }, { status: 400 })
      }
      updates.percentage = parseFloat(body.percentage.toFixed(2))
    }

    if (body.is_active !== undefined) {
      updates.is_active = Boolean(body.is_active)
    }

    if (body.valid_from !== undefined) {
      updates.valid_from = body.valid_from || null
    }

    if (body.valid_until !== undefined) {
      updates.valid_until = body.valid_until || null
    }

    // Validate date range if both dates are being updated
    if (updates.valid_from && updates.valid_until) {
      const fromDate = new Date(updates.valid_from)
      const untilDate = new Date(updates.valid_until)
      if (fromDate >= untilDate) {
        return NextResponse.json({ 
          error: 'valid_from must be before valid_until' 
        }, { status: 400 })
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Update the discount code
    const { data: code, error } = await supabase
      .from('discount_codes')
      .update(updates)
      .eq('id', params.id)
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
      if (error.code === '23503') { // Foreign key violation
        return NextResponse.json({ error: 'Invalid discount category' }, { status: 400 })
      }
      console.error('Error updating discount code:', error)
      return NextResponse.json({ error: 'Failed to update discount code' }, { status: 500 })
    }

    if (!code) {
      return NextResponse.json({ error: 'Discount code not found' }, { status: 404 })
    }

    return NextResponse.json({ code })
    
  } catch (error) {
    console.error('Error updating discount code:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/admin/discount-codes/[id] - Delete discount code
export async function DELETE(
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

    // Check if code has been used
    const { data: usage, error: usageError } = await supabase
      .from('discount_usage')
      .select('id')
      .eq('discount_code_id', params.id)
      .limit(1)

    if (usageError) {
      console.error('Error checking discount usage:', usageError)
      return NextResponse.json({ error: 'Error checking code usage' }, { status: 500 })
    }

    if (usage && usage.length > 0) {
      return NextResponse.json({ 
        error: 'Cannot delete discount code that has been used. Consider deactivating it instead.' 
      }, { status: 400 })
    }

    // Delete the discount code
    const { error } = await supabase
      .from('discount_codes')
      .delete()
      .eq('id', params.id)

    if (error) {
      console.error('Error deleting discount code:', error)
      return NextResponse.json({ error: 'Failed to delete discount code' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Discount code deleted successfully' })
    
  } catch (error) {
    console.error('Error deleting discount code:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}