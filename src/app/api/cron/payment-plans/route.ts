import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'
import { processDuePayments, sendPreNotifications } from '@/lib/services/payment-plan-processor'

/**
 * Cron Job: Daily Payment Plan Processing
 * Runs daily at 2:06 AM (staggered after cleanup and xero-sync)
 *
 * Responsibilities:
 * 1. Process due payments (xero_payments with status='planned' and planned_payment_date <= today)
 * 2. Retry failed payments (if 24+ hours since last attempt and under max attempts)
 * 3. Send pre-notifications (3 days before scheduled payment)
 * 4. Send completion emails when payment plans finish
 *
 * Vercel Cron configuration in vercel.json:
 * {
 *   "path": "/api/cron/payment-plans",
 *   "schedule": "6 2 * * *"
 * }
 */
export async function GET(request: NextRequest) {
  try {
    // Verify this is a cron request from Vercel
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      logger.logBatchProcessing(
        'cron-payment-plans-unauthorized',
        'Unauthorized cron job attempt',
        { authHeader },
        'warn'
      )
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    logger.logBatchProcessing(
      'cron-payment-plans-start',
      'Starting scheduled payment plan processing'
    )

    const today = new Date().toISOString().split('T')[0]
    const threeDaysFromNow = new Date()
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3)
    const preNotificationDate = threeDaysFromNow.toISOString().split('T')[0]

    // Process due payments using shared processor
    const results = await processDuePayments(today)

    // Send pre-notifications for payments due in 3 days
    const preNotificationsSent = await sendPreNotifications(preNotificationDate)
    results.preNotificationsSent = preNotificationsSent

    const hasErrors = results.errors.length > 0

    logger.logBatchProcessing(
      'cron-payment-plans-complete',
      'Payment plan processing completed',
      {
        paymentsProcessed: results.paymentsProcessed,
        paymentsFailed: results.paymentsFailed,
        retriesAttempted: results.retriesAttempted,
        preNotificationsSent: results.preNotificationsSent,
        completionEmailsSent: results.completionEmailsSent,
        errorCount: results.errors.length
      },
      hasErrors ? 'warn' : 'info'
    )

    return NextResponse.json({
      success: true,
      message: 'Payment plan processing completed',
      results
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    logger.logBatchProcessing(
      'cron-payment-plans-error',
      'Error during payment plan processing',
      { error: errorMessage },
      'error'
    )

    return NextResponse.json(
      {
        success: false,
        error: errorMessage
      },
      { status: 500 }
    )
  }
}
