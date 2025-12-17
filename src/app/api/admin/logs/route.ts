/**
 * Admin Logs API
 *
 * Provides endpoints for reading database logs:
 * - email_logs: Email sending history
 * - email_change_logs: Email change audit trail
 * - xero_sync_logs: Xero synchronization logs
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

type LogType = 'email_logs' | 'email_change_logs' | 'xero_sync_logs'

export async function GET(request: NextRequest) {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: userRecord } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userRecord?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Parse query parameters
    const url = new URL(request.url)
    const logType = url.searchParams.get('logType') as LogType || 'email_logs'
    const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : 100

    // Use admin client to bypass RLS
    const adminSupabase = createAdminClient()

    // Query the appropriate log table
    const { data: logs, error } = await adminSupabase
      .from(logType)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error(`Error fetching ${logType}:`, error)
      return NextResponse.json(
        { error: `Failed to fetch ${logType}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      logs,
      logType,
      total: logs.length,
      limit
    })

  } catch (error) {
    console.error('Error handling logs request:', error)

    return NextResponse.json(
      { error: 'Failed to retrieve logs' },
      { status: 500 }
    )
  }
}