import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'

export async function GET(request: NextRequest) {
  try {
    // First verify the user is authenticated and is an admin using their session
    const userSupabase = await createClient()
    const { data: { user }, error: authError } = await userSupabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify user is admin
    const { data: adminCheck, error: adminError } = await userSupabase
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

    // Now use service role client to call the admin function
    const adminSupabase = createAdminClient()
    const { data: logs, error: logsError } = await adminSupabase.rpc(
      'get_auth_audit_logs',
      {
        target_user_id: userId || null,
        limit_count: Math.min(limit, 1000), // Max 1000 per request
        offset_count: offset,
        start_date: startDate || null,
        end_date: endDate || null
      }
    )

    if (logsError) {
      logger.logAdminAction('auth-logs-fetch-error', 'Error fetching auth logs', { error: logsError.message }, user.id, 'error')
      return NextResponse.json(
        { error: 'Failed to fetch auth logs', details: logsError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      logs: logs || [],
      pagination: {
        limit,
        offset
      }
    })

  } catch (error) {
    logger.logAdminAction('auth-logs-exception', 'Unexpected error in auth-logs', { error: error instanceof Error ? error.message : String(error) }, undefined, 'error')
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
