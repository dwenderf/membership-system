import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/admin/discount-codes/[id] - Get single discount code
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userProfile } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userProfile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Discount code not found' }, { status: 404 })
      }
      throw error
    }

    return NextResponse.json({ code })
  } catch (error) {
    console.error('Error fetching discount code:', error)
    return NextResponse.json(
      { error: 'Failed to fetch discount code' },
      { status: 500 }
    )
  }
}

// PUT /api/admin/discount-codes/[id] - Update discount code
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userProfile } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userProfile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { code, percentage, valid_from, valid_until, is_active } = body

    // Validation
    if (!code?.trim()) {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 })
    }

    if (!percentage || isNaN(parseFloat(percentage)) || parseFloat(percentage) <= 0 || parseFloat(percentage) > 100) {
      return NextResponse.json({ error: 'Valid percentage between 1-100 is required' }, { status: 400 })
    }

    // Validate dates if provided
    if (valid_from && valid_until) {
      const fromDate = new Date(valid_from)
      const untilDate = new Date(valid_until)
      if (fromDate >= untilDate) {
        return NextResponse.json({ error: 'Valid from date must be before valid until date' }, { status: 400 })
      }
    }

    // Check for duplicate codes (excluding current code)
    const { data: existingCodes } = await supabase
      .from('discount_codes')
      .select('id, code')
      .neq('id', params.id)

    if (existingCodes) {
      const codeExists = existingCodes.some(existingCode => 
        existingCode.code.toLowerCase() === code.trim().toLowerCase()
      )
      if (codeExists) {
        return NextResponse.json({ error: 'A discount code with this code already exists' }, { status: 400 })
      }
    }

    // Update the discount code
    const { data: updatedCode, error } = await supabase
      .from('discount_codes')
      .update({
        code: code.trim().toUpperCase(),
        percentage: parseFloat(percentage),
        valid_from: valid_from || null,
        valid_until: valid_until || null,
        is_active: is_active ?? true,
      })
      .eq('id', params.id)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Discount code not found' }, { status: 404 })
      }
      throw error
    }

    return NextResponse.json({ 
      message: 'Discount code updated successfully',
      code: updatedCode 
    })
  } catch (error) {
    console.error('Error updating discount code:', error)
    return NextResponse.json(
      { error: 'Failed to update discount code' },
      { status: 500 }
    )
  }
}

// DELETE /api/admin/discount-codes/[id] - Delete discount code
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userProfile } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userProfile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check if code has been used
    const { data: usage } = await supabase
      .from('discount_usage')
      .select('id')
      .eq('discount_code_id', params.id)
      .limit(1)

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
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Discount code not found' }, { status: 404 })
      }
      throw error
    }

    return NextResponse.json({ 
      message: 'Discount code deleted successfully'
    })
  } catch (error) {
    console.error('Error deleting discount code:', error)
    return NextResponse.json(
      { error: 'Failed to delete discount code' },
      { status: 500 }
    )
  }
}