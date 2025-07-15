import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
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
    const { category, accounting_code } = body

    if (!category || !accounting_code) {
      return NextResponse.json({ 
        error: 'Category and accounting_code are required' 
      }, { status: 400 })
    }

    let updateResult
    
    if (category === 'memberships') {
      // Update all memberships that don't have an accounting code
      updateResult = await supabase
        .from('memberships')
        .update({ accounting_code })
        .is('accounting_code', null)

    } else if (category === 'registration_categories') {
      // Update all registration categories that don't have an accounting code
      updateResult = await supabase
        .from('registration_categories')
        .update({ accounting_code })
        .is('accounting_code', null)

    } else {
      return NextResponse.json({ 
        error: 'Invalid category. Must be "memberships" or "registration_categories"' 
      }, { status: 400 })
    }

    if (updateResult.error) {
      console.error('Error updating accounting codes:', updateResult.error)
      return NextResponse.json({ 
        error: 'Failed to update accounting codes' 
      }, { status: 500 })
    }

    // Count how many records were updated
    const { count } = await supabase
      .from(category)
      .select('id', { count: 'exact' })
      .eq('accounting_code', accounting_code)

    return NextResponse.json({
      success: true,
      updated: count || 0,
      message: `Updated ${count || 0} ${category} records`
    })

  } catch (error) {
    console.error('Error in bulk update accounting codes:', error)
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}