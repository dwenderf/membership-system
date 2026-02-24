import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/admin/discount-categories/[id] - Get single discount category
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    const { data: category, error } = await supabase
      .from('discount_categories')
      .select(`
        *,
        discount_codes (count)
      `)
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Category not found' }, { status: 404 })
      }
      throw error
    }

    return NextResponse.json({ category })
  } catch (error) {
    console.error('Error fetching discount category:', error)
    return NextResponse.json(
      { error: 'Failed to fetch discount category' },
      { status: 500 }
    )
  }
}

// PUT /api/admin/discount-categories/[id] - Update discount category
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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
    const { name, description, accounting_code, max_discount_per_user_per_season, is_active } = body

    // Validation
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    if (!accounting_code?.trim()) {
      return NextResponse.json({ error: 'Accounting code is required' }, { status: 400 })
    }

    if (max_discount_per_user_per_season !== null && max_discount_per_user_per_season !== undefined) {
      const limit = parseInt(max_discount_per_user_per_season)
      if (isNaN(limit) || limit <= 0) {
        return NextResponse.json({ error: 'Maximum discount must be a positive number' }, { status: 400 })
      }
    }

    // Check for duplicates (excluding current category)
    const { data: existingCategories } = await supabase
      .from('discount_categories')
      .select('id, name, accounting_code')
      .neq('id', id)

    if (existingCategories) {
      const nameExists = existingCategories.some(cat => 
        cat.name.toLowerCase() === name.trim().toLowerCase()
      )
      if (nameExists) {
        return NextResponse.json({ error: 'A category with this name already exists' }, { status: 400 })
      }

      const accountingCodeExists = existingCategories.some(cat => 
        cat.accounting_code.toLowerCase() === accounting_code.trim().toLowerCase()
      )
      if (accountingCodeExists) {
        return NextResponse.json({ error: 'A category with this accounting code already exists' }, { status: 400 })
      }
    }

    // Update the category
    const { data: category, error } = await supabase
      .from('discount_categories')
      .update({
        name: name.trim(),
        description: description?.trim() || null,
        accounting_code: accounting_code.trim().toUpperCase(),
        max_discount_per_user_per_season: max_discount_per_user_per_season || null,
        is_active: is_active ?? true,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Category not found' }, { status: 404 })
      }
      throw error
    }

    return NextResponse.json({ 
      message: 'Discount category updated successfully',
      category 
    })
  } catch (error) {
    console.error('Error updating discount category:', error)
    return NextResponse.json(
      { error: 'Failed to update discount category' },
      { status: 500 }
    )
  }
}

// DELETE /api/admin/discount-categories/[id] - Delete discount category
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    // Check if category has any discount codes
    const { data: codes } = await supabase
      .from('discount_codes')
      .select('id')
      .eq('discount_category_id', id)
      .limit(1)

    if (codes && codes.length > 0) {
      return NextResponse.json({ 
        error: 'Cannot delete category that has discount codes. Delete the codes first.' 
      }, { status: 400 })
    }

    // Delete the category
    const { error } = await supabase
      .from('discount_categories')
      .delete()
      .eq('id', id)

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Category not found' }, { status: 404 })
      }
      throw error
    }

    return NextResponse.json({ 
      message: 'Discount category deleted successfully'
    })
  } catch (error) {
    console.error('Error deleting discount category:', error)
    return NextResponse.json(
      { error: 'Failed to delete discount category' },
      { status: 500 }
    )
  }
}