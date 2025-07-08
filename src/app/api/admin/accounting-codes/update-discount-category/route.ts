import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    
    // Check if user is authenticated and is admin
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: userData, error: userDataError } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (userDataError || !userData?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { category_name, accounting_code } = body

    if (!category_name || !accounting_code) {
      return NextResponse.json({ 
        error: 'Category name and accounting code are required' 
      }, { status: 400 })
    }

    // Update the discount category
    const { data, error } = await supabase
      .from('discount_categories')
      .update({ accounting_code })
      .eq('name', category_name)
      .select()

    if (error) {
      console.error('Error updating discount category:', error)
      return NextResponse.json({ 
        error: 'Failed to update discount category' 
      }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ 
        error: `Discount category "${category_name}" not found` 
      }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      updated: data.length,
      message: `Updated ${category_name} accounting code to ${accounting_code}`
    })

  } catch (error) {
    console.error('Error updating discount category accounting code:', error)
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}