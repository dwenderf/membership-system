/**
 * Admin Services Management API
 * 
 * Provides admin interface for managing background services:
 * - Manual Xero sync (immediate processing)
 * - Manual payment processing
 * - Service status monitoring
 * 
 * NOTE: Scheduled processing is handled by Vercel Cron jobs:
 * - Xero sync: Every 2 minutes (Pro plan)
 * - Email retry: Every 2 hours
 * - Cleanup: Daily at 2 AM
 * - Xero keep-alive: Every 6 hours
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
        xeroSync: 'Every 2 minutes (Pro plan)',
        emailRetry: 'Every 2 hours',
        cleanup: 'Daily at 2 AM',
        xeroKeepAlive: 'Every 6 hours'
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

    const body = await request.json()
    const { action, options } = body

    switch (action) {
      case 'xero-sync': {
        logger.logXeroSync('admin-manual-sync', 'Manual Xero sync triggered by admin', { 
          adminUser: user.email,
          options 
        })

        const startTime = Date.now()
        const results = await xeroBatchSyncManager.syncAllPendingRecords()
        const duration = Date.now() - startTime

        logger.logXeroSync('admin-manual-sync-complete', 'Manual Xero sync completed', {
          adminUser: user.email,
          duration,
          results
        })

        return NextResponse.json({
          success: true,
          action: 'xero-sync',
          results,
          duration,
          timestamp: new Date().toISOString()
        })
      }

      case 'payment-processing': {
        logger.logPaymentProcessing('admin-manual-payment-processing', 'Manual payment processing triggered by admin', { 
          adminUser: user.email 
        })

        // TODO: Implement manual payment processing
        return NextResponse.json({
          success: true,
          action: 'payment-processing',
          message: 'Manual payment processing not yet implemented',
          timestamp: new Date().toISOString()
        })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }

  } catch (error) {
    console.error('Error in admin service action:', error)
    return NextResponse.json(
      { error: 'Failed to execute service action' },
      { status: 500 }
    )
  }
}