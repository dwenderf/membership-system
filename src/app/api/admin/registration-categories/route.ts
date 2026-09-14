import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

export async function POST(request: NextRequest) {
  try {
  const supabase = await createClient()
  const adminSupabase = createAdminClient()
    
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
    const { name, description, is_goalie_only } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Category name is required' }, { status: 400 })
    }

    // Check for duplicate name among system categories
    const { data: existingCategory } = await adminSupabase
      .from('categories')
      .select('id')
      .eq('name', name.trim())
      .eq('category_type', 'system')
      .single()

    if (existingCategory) {
      return NextResponse.json({ error: 'A system category with this name already exists' }, { status: 400 })
    }

    // Create the new category as a system category
    const { data: newCategory, error } = await adminSupabase
      .from('categories')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        category_type: 'system',
        created_by: user.id,
        is_goalie_only: Boolean(is_goalie_only)
      })
      .select()
      .single()

    if (error) {
      logger.logAdminAction('registration-category-create-error', 'Error creating registration category', { error: error.message }, user.id, 'error')
      return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
    }

    return NextResponse.json(newCategory)
  } catch (error) {
    logger.logAdminAction('registration-category-create-exception', 'Unexpected error creating registration category', { error: error instanceof Error ? error.message : String(error) }, undefined, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  const supabase = await createClient()
  const adminSupabase = createAdminClient()
  try {
    
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

    // Get all categories
    const { data: categories, error } = await adminSupabase
      .from('categories')
      .select('*')
      .order('category_type')
      .order('name')

    if (error) {
      logger.logAdminAction('registration-categories-fetch-error', 'Error fetching registration categories', { error: error.message }, user.id, 'error')
      return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
    }

    return NextResponse.json(categories)
  } catch (error) {
    logger.logAdminAction('registration-categories-fetch-exception', 'Unexpected error fetching registration categories', { error: error instanceof Error ? error.message : String(error) }, undefined, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}