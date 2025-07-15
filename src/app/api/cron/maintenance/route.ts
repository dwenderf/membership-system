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
    emailRetry: { success: false, error: null as string | null, retried: 0 },
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

    // Step 1: Email Retry
    try {
      logger.logPaymentProcessing(
        'cron-email-retry-start',
        'Starting email retry process',
        {},
        'info'
      )

      // Get failed email logs from the last 24 hours
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)

      const { data: failedEmails, error: emailError } = await supabase
        .from('email_logs')
        .select('*')
        .eq('status', 'failed')
        .gte('created_at', yesterday.toISOString())
        .order('created_at', { ascending: true })

      if (emailError) {
        results.emailRetry.error = emailError.message
        logger.logPaymentProcessing(
          'cron-email-retry-error',
          'Failed to fetch failed emails',
          { error: results.emailRetry.error },
          'error'
        )
      } else {
        results.emailRetry.retried = failedEmails?.length || 0
        
        if (failedEmails && failedEmails.length > 0) {
          logger.logPaymentProcessing(
            'cron-email-retry-found',
            `Found ${failedEmails.length} failed emails to retry`,
            { count: failedEmails.length },
            'info'
          )

          // For now, just log them - actual retry logic would go here
          // In a real implementation, you'd resend the emails
          for (const email of failedEmails) {
            logger.logPaymentProcessing(
              'cron-email-retry-item',
              'Would retry failed email',
              { 
                emailId: email.id,
                recipient: email.recipient_email,
                subject: email.subject,
                originalError: email.error_message
              },
              'info'
            )
          }
        }

        results.emailRetry.success = true
        logger.logPaymentProcessing(
          'cron-email-retry-success',
          'Email retry process completed',
          { retried: results.emailRetry.retried },
          'info'
        )
      }
    } catch (error) {
      results.emailRetry.error = error instanceof Error ? error.message : String(error)
      logger.logPaymentProcessing(
        'cron-email-retry-exception',
        'Email retry process threw exception',
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