/**
 * Admin Services Management API
 * 
 * Provides admin interface for managing background services:
 * - Start/stop payment processing
 * - Manual batch processing
 * - Service status monitoring
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceManager } from '@/lib/services/startup'
import { paymentProcessor } from '@/lib/payment-completion-processor'
import { xeroBatchSyncManager } from '@/lib/xero/batch-sync'
import { scheduledBatchProcessor } from '@/lib/scheduled-batch-processor'
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
    const batchProcessorStatus = scheduledBatchProcessor.getStatus()
    
    return NextResponse.json({
      services: status,
      batchProcessor: batchProcessorStatus,
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

      case 'start-batch-processor':
        logger.logAdminAction(
          'start-batch-processor',
          'Admin started scheduled batch processor',
          { action },
          user.id
        )
        await scheduledBatchProcessor.startScheduledProcessing()
        return NextResponse.json({ 
          message: 'Scheduled batch processor started',
          status: scheduledBatchProcessor.getStatus()
        })

      case 'stop-batch-processor':
        logger.logAdminAction(
          'stop-batch-processor',
          'Admin stopped scheduled batch processor',
          { action },
          user.id
        )
        await scheduledBatchProcessor.stopScheduledProcessing()
        return NextResponse.json({ 
          message: 'Scheduled batch processor stopped',
          status: scheduledBatchProcessor.getStatus()
        })

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: start, stop, restart, process-pending, sync-xero, start-batch-processor, or stop-batch-processor' },
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