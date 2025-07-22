import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore })

  try {
    // Check authentication
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin privileges
    const { data: user } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', session.user.id)
      .single()

    if (!user?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Get the category
    const { data: category, error } = await supabase
      .from('categories')
      .select('*')
      .eq('id', params.id)
      .single()

    if (error || !category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    return NextResponse.json(category)
  } catch (error) {
    console.error('Error in GET /api/admin/registration-categories/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore })

  try {
    // Check authentication
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin privileges
    const { data: user } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', session.user.id)
      .single()

    if (!user?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Check if category exists
    const { data: existingCategory } = await supabase
      .from('categories')
      .select('*')
      .eq('id', params.id)
      .single()

    if (!existingCategory) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    const body = await request.json()
    const { name, description } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Category name is required' }, { status: 400 })
    }

    // Check for duplicate name among system categories (excluding this one)
    const { data: duplicateCategory } = await supabase
      .from('categories')
      .select('id')
      .eq('name', name.trim())
      .eq('category_type', 'system')
      .neq('id', params.id)
      .single()

    if (duplicateCategory) {
      return NextResponse.json({ error: 'A system category with this name already exists' }, { status: 400 })
    }

    // Update the category
    const { data: updatedCategory, error } = await supabase
      .from('categories')
      .update({
        name: name.trim(),
        description: description?.trim() || null
      })
      .eq('id', params.id)
      .select()
      .single()

    if (error) {
      console.error('Error updating category:', error)
      return NextResponse.json({ error: 'Failed to update category' }, { status: 500 })
    }

    return NextResponse.json(updatedCategory)
  } catch (error) {
    console.error('Error in PUT /api/admin/registration-categories/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}