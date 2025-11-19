import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify user is admin
    const { data: adminCheck, error: adminError } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (adminError || !adminCheck?.is_admin) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      )
    }

    // Get query params
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('user_id')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')

    // Call the database function to get auth audit logs
    const { data: logs, error: logsError } = await supabase.rpc(
      'get_auth_audit_logs',
      {
        target_user_id: userId || null,
        limit_count: Math.min(limit, 100), // Max 100 per request
        offset_count: offset,
        start_date: startDate || null,
        end_date: endDate || null
      }
    )

    if (logsError) {
      console.error('Error fetching auth logs:', logsError)
      return NextResponse.json(
        { error: 'Failed to fetch auth logs', details: logsError.message },
        { status: 500 }
      )
    }

    // Get total count for pagination (if no user filter)
    let totalCount = null
    if (!userId) {
      const { count, error: countError } = await supabase.rpc(
        'get_auth_audit_logs',
        {
          target_user_id: null,
          limit_count: 1000000, // Large number to get count
          offset_count: 0
        }
      )

      if (!countError && count) {
        totalCount = count
      }
    }

    return NextResponse.json({
      logs: logs || [],
      pagination: {
        limit,
        offset,
        total: totalCount
      }
    })

  } catch (error) {
    console.error('Unexpected error in auth-logs:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
