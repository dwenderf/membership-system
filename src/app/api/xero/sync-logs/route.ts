import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    
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

    // Get pagination and time window parameters
    const offset = parseInt(searchParams.get('offset') || '0')
    const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 100) // Cap at 100
    const timeWindow = searchParams.get('timeWindow') || '24h'
    
    let timeRange: number
    switch (timeWindow) {
      case '7d':
        timeRange = 7 * 24 * 60 * 60 * 1000
        break
      case '30d':
        timeRange = 30 * 24 * 60 * 60 * 1000
        break
      case '24h':
      default:
        timeRange = 24 * 60 * 60 * 1000
        break
    }

    // Get sync logs with pagination
    const { data: syncLogs, error: syncLogsError } = await supabase
      .from('xero_sync_logs')
      .select('id, status, operation_type, entity_type, created_at, response_data, request_data, error_message')
      .gte('created_at', new Date(Date.now() - timeRange).toISOString())
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (syncLogsError) {
      console.error('Error fetching sync logs:', syncLogsError)
      return NextResponse.json({ error: 'Failed to fetch sync logs' }, { status: 500 })
    }

    return NextResponse.json({
      logs: syncLogs || [],
      offset,
      limit,
      hasMore: (syncLogs?.length || 0) === limit
    })

  } catch (error) {
    console.error('Error in sync logs API:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch sync logs' 
    }, { status: 500 })
  }
}