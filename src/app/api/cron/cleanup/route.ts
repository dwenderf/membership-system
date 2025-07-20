import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'

export async function GET(request: NextRequest) {
  try {
    // Verify this is a legitimate cron request
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.logBatchProcessing('cron-cleanup-start', '🕐 Scheduled cleanup started')

    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    
    const results = {
      stagingRecordsCleaned: 0,
      logEntriesCleaned: 0,
      errors: [] as string[]
    }

    // Clean up old staging records (older than 30 days)
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      
      const { data: oldStagingRecords, error: stagingError } = await supabase
        .from('xero_invoices')
        .select('id')
        .lt('created_at', thirtyDaysAgo)
        .in('sync_status', ['synced', 'failed'])

      if (stagingError) {
        results.errors.push(`Staging records cleanup error: ${stagingError.message}`)
      } else if (oldStagingRecords && oldStagingRecords.length > 0) {
        // Delete old staging records
        const { error: deleteError } = await supabase
          .from('xero_invoices')
          .delete()
          .lt('created_at', thirtyDaysAgo)
          .in('sync_status', ['synced', 'failed'])

        if (deleteError) {
          results.errors.push(`Staging records deletion error: ${deleteError.message}`)
        } else {
          results.stagingRecordsCleaned = oldStagingRecords.length
        }
      }
    } catch (error) {
      results.errors.push(`Staging cleanup error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    // Clean up old log entries (older than 90 days)
    try {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
      
      const { data: oldLogEntries, error: logError } = await supabase
        .from('email_logs')
        .select('id')
        .lt('created_at', ninetyDaysAgo)

      if (logError) {
        results.errors.push(`Log entries cleanup error: ${logError.message}`)
      } else if (oldLogEntries && oldLogEntries.length > 0) {
        // Delete old log entries
        const { error: deleteError } = await supabase
          .from('email_logs')
          .delete()
          .lt('created_at', ninetyDaysAgo)

        if (deleteError) {
          results.errors.push(`Log entries deletion error: ${deleteError.message}`)
        } else {
          results.logEntriesCleaned = oldLogEntries.length
        }
      }
    } catch (error) {
      results.errors.push(`Log cleanup error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    const totalCleaned = results.stagingRecordsCleaned + results.logEntriesCleaned
    const hasErrors = results.errors.length > 0

    logger.logBatchProcessing('cron-cleanup-results', 'Scheduled cleanup completed', {
      stagingRecordsCleaned: results.stagingRecordsCleaned,
      logEntriesCleaned: results.logEntriesCleaned,
      totalCleaned,
      errorCount: results.errors.length
    }, hasErrors ? 'warn' : 'info')

    return NextResponse.json({
      success: true,
      message: 'Cleanup completed successfully',
      results: {
        stagingRecordsCleaned: results.stagingRecordsCleaned,
        logEntriesCleaned: results.logEntriesCleaned,
        totalCleaned,
        errors: results.errors
      }
    })

  } catch (error) {
    logger.logBatchProcessing('cron-cleanup-error', '❌ Scheduled cleanup error', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 'error')
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
} 