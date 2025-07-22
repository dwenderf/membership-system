import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const { name, description } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Category name is required' }, { status: 400 })
    }

    // Check for duplicate name among system categories
    const { data: existingCategory } = await supabase
      .from('categories')
      .select('id')
      .eq('name', name.trim())
      .eq('category_type', 'system')
      .single()

    if (existingCategory) {
      return NextResponse.json({ error: 'A system category with this name already exists' }, { status: 400 })
    }

    // Create the new category as a system category
    const { data: newCategory, error } = await supabase
      .from('categories')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        category_type: 'system',
        created_by: session.user.id
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating category:', error)
      return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
    }

    return NextResponse.json(newCategory)
  } catch (error) {
    console.error('Error in POST /api/admin/registration-categories:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
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

    // Get all categories
    const { data: categories, error } = await supabase
      .from('categories')
      .select('*')
      .order('category_type')
      .order('name')

    if (error) {
      console.error('Error fetching categories:', error)
      return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
    }

    return NextResponse.json(categories)
  } catch (error) {
    console.error('Error in GET /api/admin/registration-categories:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}