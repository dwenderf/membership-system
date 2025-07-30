import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'

export async function GET(request: NextRequest) {
  try {
    // Verify this is a legitimate cron request
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.logBatchProcessing('cron-email-sync-start', '🕐 Scheduled email sync started')

    const results = {
      stagedEmails: { processed: 0, successful: 0, failed: 0, errors: [] as string[] },
      failedRetries: { retried: 0, successful: 0, failed: 0, errors: [] as string[] }
    }

    // Step 1: Process staged emails (limit 100 per batch)
    try {
      logger.logBatchProcessing('cron-staged-emails-start', 'Processing staged emails (limit: 100)')
      
      const startTime = new Date()
      const { emailProcessingManager } = await import('@/lib/email/batch-sync-email')
      const stagedResults = await emailProcessingManager.processStagedEmails({ limit: 100 })
      
      // Log system event for staged emails
      const { logSyncEvent } = await import('@/lib/system-events')
      await logSyncEvent(
        'email_sync',
        'cron_job',
        startTime,
        {
          processed: stagedResults.results?.processed || 0,
          successful: stagedResults.results?.successful || 0,
          failed: stagedResults.results?.failed || 0,
          errors: stagedResults.results?.errors
        },
        stagedResults.error
      )
      
      if (stagedResults.success && stagedResults.results) {
        results.stagedEmails = stagedResults.results
        logger.logBatchProcessing('cron-staged-emails-complete', 'Staged email processing completed', {
          processed: results.stagedEmails.processed,
          successful: results.stagedEmails.successful,
          failed: results.stagedEmails.failed
        })
      } else {
        results.stagedEmails.errors.push(stagedResults.error || 'Unknown error')
        logger.logBatchProcessing('cron-staged-emails-error', 'Staged email processing failed', {
          error: stagedResults.error
        }, 'error')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      results.stagedEmails.errors.push(errorMessage)
      logger.logBatchProcessing('cron-staged-emails-exception', 'Staged email processing exception', {
        error: errorMessage
      }, 'error')
    }

    // Step 2: Retry failed emails from the last 24 hours
    try {
      logger.logBatchProcessing('cron-failed-retries-start', 'Processing failed email retries')
      
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = await createClient()
      
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      
      const { data: failedEmails, error } = await supabase
        .from('email_logs')
        .select('*')
        .eq('status', 'failed')
        .gte('created_at', twentyFourHoursAgo)
        .limit(50) // Limit failed retries to prevent overwhelming

      if (error) {
        results.failedRetries.errors.push(`Database error: ${error.message}`)
        logger.logBatchProcessing('cron-failed-retries-error', 'Failed to fetch failed emails', { 
          error: error.message 
        }, 'error')
      } else if (failedEmails && failedEmails.length > 0) {
        logger.logBatchProcessing('cron-failed-retries-processing', `Retrying ${failedEmails.length} failed emails`)
        
        // TODO: Implement failed email retry logic
        // For now, just log that we would retry them
        results.failedRetries.retried = failedEmails.length
        results.failedRetries.successful = 0
        results.failedRetries.failed = failedEmails.length
        
        logger.logBatchProcessing('cron-failed-retries-results', 'Failed email retry processing completed (not yet implemented)', {
          retried: failedEmails.length,
          successful: 0,
          failed: failedEmails.length,
          note: 'Failed email retry logic needs to be implemented'
        })
      } else {
        logger.logBatchProcessing('cron-failed-retries-skip', 'No failed emails to retry')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      results.failedRetries.errors.push(errorMessage)
      logger.logBatchProcessing('cron-failed-retries-exception', 'Failed email retry exception', {
        error: errorMessage
      }, 'error')
    }

    const totalProcessed = results.stagedEmails.processed + results.failedRetries.retried
    const totalSuccessful = results.stagedEmails.successful + results.failedRetries.successful
    const totalFailed = results.stagedEmails.failed + results.failedRetries.failed

    logger.logBatchProcessing('cron-email-sync-complete', 'Email sync cron job completed', {
      totalProcessed,
      totalSuccessful,
      totalFailed,
      stagedEmails: results.stagedEmails,
      failedRetries: results.failedRetries
    })

    return NextResponse.json({
      success: true,
      message: 'Email sync cron job completed',
      results: {
        totalProcessed,
        totalSuccessful,
        totalFailed,
        stagedEmails: results.stagedEmails,
        failedRetries: results.failedRetries
      }
    })

  } catch (error) {
    logger.logBatchProcessing('cron-email-sync-error', '❌ Scheduled email sync error', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 'error')
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
} 