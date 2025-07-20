import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceManager } from '@/lib/services/startup'

export async function GET(request: NextRequest) {
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

    // Get service status
    const serviceStatus = serviceManager.getStatus()
    
    // Get recent service logs to show activity
    const { data: serviceLogs } = await supabase
      .from('system_logs')
      .select('timestamp, level, category, operation, message, metadata')
      .eq('category', 'service-management')
      .order('timestamp', { ascending: false })
      .limit(10)

    return NextResponse.json({
      services: serviceStatus,
      recent_logs: serviceLogs || [],
      server_info: {
        uptime: process.uptime(),
        memory_usage: process.memoryUsage(),
        pid: process.pid,
        node_version: process.version,
        platform: process.platform
      }
    })

  } catch (error) {
    console.error('Error fetching service status:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch service status',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}