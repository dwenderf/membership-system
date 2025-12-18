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

// Safe display names to prevent format string vulnerabilities
const LOG_TYPE_NAMES: Record<LogType, string> = {
  'email_logs': 'email_logs',
  'email_change_logs': 'email_change_logs',
  'xero_sync_logs': 'xero_sync_logs'
} as const

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
    const logTypeParam = url.searchParams.get('logType') || 'email_logs'
    const limitParam = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : 100

    // Validate limit to prevent excessive database load
    const limit = Math.min(Math.max(limitParam, 1), 1000) // Clamp between 1 and 1000

    // Validate logType against whitelist to prevent SQL injection
    const validLogTypes: LogType[] = ['email_logs', 'email_change_logs', 'xero_sync_logs']
    const logType = validLogTypes.includes(logTypeParam as LogType)
      ? (logTypeParam as LogType)
      : 'email_logs'

    // Use admin client to bypass RLS
    const adminSupabase = createAdminClient()

    // Use indexed column for sorting to improve performance
    // email_logs has an index on sent_at, others use created_at
    const sortColumn = logType === 'email_logs' ? 'sent_at' : 'created_at'

    // Query the appropriate log table
    const { data: logs, error } = await adminSupabase
      .from(logType)
      .select('*')
      .order(sortColumn, { ascending: false })
      .limit(limit)

    if (error) {
      // Use safe mapping to prevent format string vulnerabilities
      const safeLogTypeName = LOG_TYPE_NAMES[logType]
      console.error(`Error fetching ${safeLogTypeName}:`, error)
      return NextResponse.json(
        { error: `Failed to fetch ${safeLogTypeName}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      logs,
      logType,
      count: logs.length, // Number of logs returned (not total in DB)
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