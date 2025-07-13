/**
 * Admin Logs API
 * 
 * Provides endpoints for reading and managing application logs
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger, LogLevel, LogCategory } from '@/lib/logging/logger'

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
    const category = url.searchParams.get('category') as LogCategory | null
    const level = url.searchParams.get('level') as LogLevel | null
    const startDate = url.searchParams.get('startDate')
    const endDate = url.searchParams.get('endDate')
    const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : 100
    const action = url.searchParams.get('action') || 'logs'

    // Handle different actions
    switch (action) {
      case 'stats':
        const stats = await logger.getLogStats()
        return NextResponse.json({ stats })

      case 'logs':
      default:
        const logs = await logger.readLogs(
          category || undefined,
          level || undefined,
          startDate || undefined,
          endDate || undefined,
          limit
        )
        
        return NextResponse.json({ 
          logs,
          filters: {
            category,
            level,
            startDate,
            endDate,
            limit
          },
          total: logs.length
        })
    }

  } catch (error) {
    console.error('Error handling logs request:', error)
    await logger.error(
      'admin-action',
      'logs-api-error',
      'Failed to handle admin logs request',
      { error: error instanceof Error ? error.message : String(error) }
    )
    
    return NextResponse.json(
      { error: 'Failed to retrieve logs' },
      { status: 500 }
    )
  }
}