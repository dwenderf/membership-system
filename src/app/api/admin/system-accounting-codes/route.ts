import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/admin/system-accounting-codes - Get all system accounting codes
export async function GET() {
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

    // Get all system accounting codes
    const { data: codes, error } = await supabase
      .from('system_accounting_codes')
      .select('*')
      .order('code_type')

    if (error) {
      console.error('Error fetching system accounting codes:', error)
      return NextResponse.json({ error: 'Failed to fetch system accounting codes' }, { status: 500 })
    }

    return NextResponse.json({ codes })
    
  } catch (error) {
    console.error('Error in system accounting codes API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/admin/system-accounting-codes - Update system accounting codes
export async function PUT(request: NextRequest) {
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
    const { updates } = body

    if (!Array.isArray(updates)) {
      return NextResponse.json({ error: 'Updates must be an array' }, { status: 400 })
    }

    let successCount = 0
    let errorCount = 0
    const results = []

    // Process each update
    for (const update of updates) {
      const { code_type, accounting_code } = update

      if (!code_type || !accounting_code?.trim()) {
        results.push({
          code_type,
          success: false,
          error: 'Missing code_type or accounting_code'
        })
        errorCount++
        continue
      }

      try {
        const { error: updateError } = await supabase
          .from('system_accounting_codes')
          .update({ 
            accounting_code: accounting_code.trim(),
            updated_at: new Date().toISOString()
          })
          .eq('code_type', code_type)

        if (updateError) {
          results.push({
            code_type,
            success: false,
            error: updateError.message
          })
          errorCount++
        } else {
          results.push({
            code_type,
            success: true
          })
          successCount++
        }
      } catch (err) {
        results.push({
          code_type,
          success: false,
          error: 'Database error'
        })
        errorCount++
      }
    }

    return NextResponse.json({
      successCount,
      errorCount,
      results
    })
    
  } catch (error) {
    console.error('Error in system accounting codes update API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}