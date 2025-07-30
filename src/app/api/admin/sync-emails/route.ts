import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

export async function POST(request: NextRequest) {
  try {
    // Verify admin access (you might want to add more robust auth here)
    const supabase = createAdminClient()
    
    // Get user info for initiator
    const { data: { user } } = await supabase.auth.getUser()
    const initiator = user ? `manual (${user.email})` : 'manual (unknown)'
    
    // Get pending email count
    const { count: pendingEmails } = await supabase
      .from('email_logs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')

    // Get failed email count from last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count: failedEmails } = await supabase
      .from('email_logs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('created_at', twentyFourHoursAgo)

    const startTime = new Date()
    
    // Process emails
    const { emailProcessingManager } = await import('@/lib/email/batch-sync-email')
    const results = await emailProcessingManager.processStagedEmails({ limit: 100 })

    // Log system event
    const { logSyncEvent } = await import('@/lib/system-events')
    await logSyncEvent(
      'email_sync',
      initiator,
      startTime,
      {
        processed: results.results?.processed || 0,
        successful: results.results?.successful || 0,
        failed: results.results?.failed || 0,
        errors: results.results?.errors
      },
      results.error
    )

    logger.logBatchProcessing('admin-sync-emails', 'Manual email sync triggered from admin dashboard', {
      pendingEmails,
      failedEmails,
      results
    })

    return NextResponse.json({
      success: true,
      message: 'Email sync completed',
      results: {
        pendingEmails,
        failedEmails,
        processed: results.results?.processed || 0,
        successful: results.results?.successful || 0,
        failed: results.results?.failed || 0
      }
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    logger.logBatchProcessing('admin-sync-emails-error', 'Manual email sync failed', { 
      error: errorMessage
    }, 'error')

    return NextResponse.json({
      success: false,
      error: errorMessage
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    
    // Get pending email count
    const { count: pendingEmails } = await supabase
      .from('email_logs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')

    // Get failed email count from last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count: failedEmails } = await supabase
      .from('email_logs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('created_at', twentyFourHoursAgo)

    return NextResponse.json({
      success: true,
      pendingEmails: pendingEmails || 0,
      failedEmails: failedEmails || 0
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    return NextResponse.json({
      success: false,
      error: errorMessage
    }, { status: 500 })
  }
} 