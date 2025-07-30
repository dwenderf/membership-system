import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  const results = {
    emailRetry: { success: false, error: null as string | null, retried: 0, successful: 0, failed: 0 },
    cleanup: { success: false, error: null as string | null, cleaned: 0 }
  }

  try {
    logger.logPaymentProcessing(
      'cron-maintenance-start',
      'Starting maintenance cron job',
      { timestamp: new Date().toISOString() },
      'info'
    )

    const supabase = createAdminClient()

    // Step 1: Email Processing
    try {
      logger.logPaymentProcessing(
        'cron-email-processing-start',
        'Starting email processing',
        {},
        'info'
      )

      // Process failed email retries (not staged emails)
      // Note: Staged emails are processed immediately by PaymentCompletionProcessor
      // This endpoint only handles retries of failed emails
      logger.logPaymentProcessing(
        'cron-email-retry-start',
        'Starting failed email retry processing',
        {},
        'info'
      )

      // TODO: Implement failed email retry logic
      // This should:
      // 1. Query email_logs for failed emails (status = 'failed')
      // 2. Retry emails that haven't exceeded max retry count
      // 3. Use intelligent backoff for retries
      
      results.emailRetry.retried = 0
      results.emailRetry.successful = 0
      results.emailRetry.failed = 0

      logger.logPaymentProcessing(
        'cron-email-retry-complete',
        'Failed email retry processing completed (not yet implemented)',
        { 
          retried: 0,
          successful: 0,
          failed: 0,
          note: 'Failed email retry logic needs to be implemented'
        },
        'info'
      )

      results.emailRetry.success = true
    } catch (error) {
      results.emailRetry.error = error instanceof Error ? error.message : String(error)
      logger.logPaymentProcessing(
        'cron-email-processing-exception',
        'Email processing threw exception',
        { error: results.emailRetry.error },
        'error'
      )
    }

    // Step 2: Cleanup
    try {
      logger.logPaymentProcessing(
        'cron-cleanup-start',
        'Starting cleanup process',
        {},
        'info'
      )

      // Clean up expired reservations (older than 1 hour)
      const oneHourAgo = new Date()
      oneHourAgo.setHours(oneHourAgo.getHours() - 1)

      const { data: expiredReservations, error: cleanupError } = await supabase
        .from('user_registrations')
        .select('id')
        .eq('payment_status', 'awaiting_payment')
        .lt('reservation_expires_at', oneHourAgo.toISOString())

      if (cleanupError) {
        results.cleanup.error = cleanupError.message
        logger.logPaymentProcessing(
          'cron-cleanup-error',
          'Failed to fetch expired reservations',
          { error: results.cleanup.error },
          'error'
        )
      } else {
        results.cleanup.cleaned = expiredReservations?.length || 0

        if (expiredReservations && expiredReservations.length > 0) {
          logger.logPaymentProcessing(
            'cron-cleanup-found',
            `Found ${expiredReservations.length} expired reservations to clean up`,
            { count: expiredReservations.length },
            'info'
          )

          // Update expired reservations to failed status
          const { error: updateError } = await supabase
            .from('user_registrations')
            .update({ 
              payment_status: 'failed',
              reservation_expires_at: null
            })
            .in('id', expiredReservations.map(r => r.id))

          if (updateError) {
            results.cleanup.error = updateError.message
            logger.logPaymentProcessing(
              'cron-cleanup-update-error',
              'Failed to update expired reservations',
              { error: results.cleanup.error },
              'error'
            )
          } else {
            logger.logPaymentProcessing(
              'cron-cleanup-update-success',
              'Successfully updated expired reservations to failed status',
              { updated: expiredReservations.length },
              'info'
            )
          }
        }

        results.cleanup.success = true
        logger.logPaymentProcessing(
          'cron-cleanup-success',
          'Cleanup process completed',
          { cleaned: results.cleanup.cleaned },
          'info'
        )
      }
    } catch (error) {
      results.cleanup.error = error instanceof Error ? error.message : String(error)
      logger.logPaymentProcessing(
        'cron-cleanup-exception',
        'Cleanup process threw exception',
        { error: results.cleanup.error },
        'error'
      )
    }

    const duration = Date.now() - startTime
    const overallSuccess = results.emailRetry.success && results.cleanup.success

    logger.logPaymentProcessing(
      'cron-maintenance-complete',
      `Maintenance cron job completed in ${duration}ms`,
      { 
        duration,
        overallSuccess,
        results
      },
      overallSuccess ? 'info' : 'warn'
    )

    return NextResponse.json({
      success: overallSuccess,
      duration,
      results,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    logger.logPaymentProcessing(
      'cron-maintenance-error',
      'Maintenance cron job failed with exception',
      { 
        duration,
        error: errorMessage
      },
      'error'
    )

    return NextResponse.json({
      success: false,
      error: errorMessage,
      duration,
      results,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
} 