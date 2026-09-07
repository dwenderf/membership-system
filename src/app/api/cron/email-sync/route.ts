import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'

/**
 * Scheduled email sync — processes staged (status 'pending') email_logs rows.
 *
 * There is deliberately NO "retry failed emails" step. Retry of transient
 * failures already happens through the 'pending' path: sendStagedEmail keeps a
 * row 'pending' on network/socket errors precisely so the next run picks it up
 * (see src/lib/email/batch-sync-email.ts). status 'failed' is reserved for hard
 * failures where the Loops API rejected the send, which must NOT be retried
 * automatically — every run would re-hit the same rejection.
 *
 * A step that queried those rows existed here and never worked: it built its
 * own anon-key client, and email_logs' only SELECT policy is
 * `auth.uid() = user_id`, so with no session on a cron request it matched zero
 * rows on every run without erroring. It also never retried anything, being an
 * unimplemented TODO. Removed rather than fixed — see issue #281.
 *
 * Hard-failed counts are surfaced where a human can act on them: the admin
 * dashboard's Sync Emails panel, via GET /api/admin/sync-emails.
 */

export async function GET(request: NextRequest) {
  try {
    // Verify this is a legitimate cron request
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.logBatchProcessing('cron-email-sync-start', '🕐 Scheduled email sync started')

    const results = {
      stagedEmails: { processed: 0, successful: 0, failed: 0, errors: [] as string[] }
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

    logger.logBatchProcessing('cron-email-sync-complete', 'Email sync cron job completed', {
      totalProcessed: results.stagedEmails.processed,
      totalSuccessful: results.stagedEmails.successful,
      totalFailed: results.stagedEmails.failed,
      stagedEmails: results.stagedEmails
    })

    return NextResponse.json({
      success: true,
      message: 'Email sync cron job completed',
      results: {
        totalProcessed: results.stagedEmails.processed,
        totalSuccessful: results.stagedEmails.successful,
        totalFailed: results.stagedEmails.failed,
        stagedEmails: results.stagedEmails
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