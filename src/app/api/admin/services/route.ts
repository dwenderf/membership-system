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
import { xeroBatchSyncManager } from '@/lib/xero-batch-sync'
import { scheduledBatchProcessor } from '@/lib/scheduled-batch-processor'

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
        await serviceManager.startServices()
        return NextResponse.json({ 
          message: 'Services started',
          status: serviceManager.getStatus()
        })

      case 'stop':
        await serviceManager.stopServices()
        return NextResponse.json({ 
          message: 'Services stopped',
          status: serviceManager.getStatus()
        })

      case 'restart':
        await serviceManager.restartServices()
        return NextResponse.json({ 
          message: 'Services restarted',
          status: serviceManager.getStatus()
        })

      case 'process-pending':
        await paymentProcessor.processPendingRecords()
        return NextResponse.json({ 
          message: 'Pending records processed'
        })

      case 'sync-xero':
        const syncResults = await xeroBatchSyncManager.syncAllPendingRecords()
        return NextResponse.json({ 
          message: 'Xero batch sync completed',
          results: syncResults
        })

      case 'start-batch-processor':
        await scheduledBatchProcessor.startScheduledProcessing()
        return NextResponse.json({ 
          message: 'Scheduled batch processor started',
          status: scheduledBatchProcessor.getStatus()
        })

      case 'stop-batch-processor':
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