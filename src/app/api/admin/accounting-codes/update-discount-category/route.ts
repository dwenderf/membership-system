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
    const { updates } = body

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ 
        error: 'Updates array is required' 
      }, { status: 400 })
    }

    // Validate all updates have required fields
    for (const update of updates) {
      if (!update.category_id || !update.accounting_code) {
        return NextResponse.json({ 
          error: 'Each update must have category_id and accounting_code' 
        }, { status: 400 })
      }
    }

    let successCount = 0
    let errorCount = 0
    const results = []

    // Process each update
    for (const update of updates) {
      try {
        const { data, error } = await supabase
          .from('discount_categories')
          .update({ accounting_code: update.accounting_code })
          .eq('id', update.category_id)
          .select()

        if (error) {
          console.error('Error updating category:', update.category_id, error)
          errorCount++
          results.push({ 
            category_id: update.category_id, 
            success: false, 
            error: error.message 
          })
        } else if (!data || data.length === 0) {
          errorCount++
          results.push({ 
            category_id: update.category_id, 
            success: false, 
            error: 'Category not found' 
          })
        } else {
          successCount++
          results.push({ 
            category_id: update.category_id, 
            success: true, 
            name: data[0].name 
          })
        }
      } catch (error) {
        console.error('Error processing update for category:', update.category_id, error)
        errorCount++
        results.push({ 
          category_id: update.category_id, 
          success: false, 
          error: 'Processing error' 
        })
      }
    }

    return NextResponse.json({
      success: successCount > 0,
      successCount,
      errorCount,
      results
    })

  } catch (error) {
    console.error('Error updating discount category accounting code:', error)
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}