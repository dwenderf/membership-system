/**
 * Admin Services Management API
 * 
 * Provides admin interface for managing background services:
 * - Manual Xero sync (immediate processing)
 * - Manual payment processing
 * - Service status monitoring
 * 
 * NOTE: Scheduled processing is handled by Vercel Cron jobs:
 * - Xero sync: Daily at 2 AM
 * - Email retry: Daily at 4 AM
 * - Cleanup: Daily at 6 AM
 * - Xero keep-alive: Daily at midnight
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceManager } from '@/lib/services/startup'
import { paymentProcessor } from '@/lib/payment-completion-processor'
import { xeroBatchSyncManager } from '@/lib/xero/batch-sync'
import { logger } from '@/lib/logging/logger'

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

    // Return service status
    const status = serviceManager.getStatus()
    
    return NextResponse.json({
      services: status,
      cronJobs: {
        xeroSync: 'Daily at 2 AM',
        emailRetry: 'Daily at 4 AM',
        cleanup: 'Daily at 6 AM',
        xeroKeepAlive: 'Daily at midnight'
      },
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Error getting service status:', error)
    return NextResponse.json(
      { error: 'Failed to get service status' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
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

    const { action } = await request.json()

    switch (action) {
      case 'start':
        logger.logAdminAction(
          'start-services',
          'Admin initiated service start',
          { action },
          user.id
        )
        await serviceManager.startServices()
        return NextResponse.json({ 
          message: 'Services started',
          status: serviceManager.getStatus()
        })

      case 'stop':
        logger.logAdminAction(
          'stop-services',
          'Admin initiated service stop',
          { action },
          user.id
        )
        await serviceManager.stopServices()
        return NextResponse.json({ 
          message: 'Services stopped',
          status: serviceManager.getStatus()
        })

      case 'restart':
        logger.logAdminAction(
          'restart-services',
          'Admin initiated service restart',
          { action },
          user.id
        )
        await serviceManager.restartServices()
        return NextResponse.json({ 
          message: 'Services restarted',
          status: serviceManager.getStatus()
        })

      case 'process-pending':
        logger.logAdminAction(
          'process-pending',
          'Admin triggered manual payment processing',
          { action },
          user.id
        )
        await paymentProcessor.processPendingRecords()
        return NextResponse.json({ 
          message: 'Pending records processed'
        })

      case 'sync-xero':
        logger.logAdminAction(
          'sync-xero',
          'Admin triggered manual Xero sync',
          { action },
          user.id
        )
        const syncResults = await xeroBatchSyncManager.syncAllPendingRecords()
        return NextResponse.json({ 
          message: 'Xero batch sync completed',
          results: syncResults
        })

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: start, stop, restart, process-pending, or sync-xero' },
          { status: 400 }
        )
    }

  } catch (error) {
    console.error('Error managing services:', error)
    return NextResponse.json(
      { error: 'Failed to manage services' },
      { status: 500 }
    )
  }
}