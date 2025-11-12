import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { processDuePayments, sendPreNotifications } from '@/lib/services/payment-plan-processor'

/**
 * Manual Payment Processing Endpoint (Simplified for Testing)
 *
 * This endpoint allows admins to manually trigger payment plan processing
 * without waiting for the daily cron job. Useful for testing payment plans.
 *
 * POST /api/admin/payment-plans/run-payments
 *
 * Authorization: Requires authenticated admin user
 *
 * This processes all payments that are due today (or overdue) based on their
 * planned_payment_date in the xero_payments table.
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication and admin status
    const supabase = await createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()

    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: currentUser } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()

    if (!currentUser?.is_admin) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    logger.logBatchProcessing(
      'manual-run-payments-start',
      'Starting manual payment processing',
      { userId: authUser.id }
    )

    const today = new Date().toISOString().split('T')[0]
    const threeDaysFromNow = new Date()
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3)
    const preNotificationDate = threeDaysFromNow.toISOString().split('T')[0]

    // Process due payments using shared processor
    // This ensures manual runs and cron job use identical logic
    const results = await processDuePayments(today)

    // Send pre-notifications for payments due in 3 days (same as cron job)
    const preNotificationsSent = await sendPreNotifications(preNotificationDate)
    results.preNotificationsSent = preNotificationsSent

    const hasErrors = results.errors.length > 0

    logger.logBatchProcessing(
      'manual-run-payments-complete',
      'Manual payment processing completed',
      {
        paymentsFound: results.paymentsFound,
        paymentsProcessed: results.paymentsProcessed,
        paymentsFailed: results.paymentsFailed,
        retriesAttempted: results.retriesAttempted,
        completionEmailsSent: results.completionEmailsSent,
        preNotificationsSent: results.preNotificationsSent,
        errorCount: results.errors.length
      },
      hasErrors ? 'warn' : 'info'
    )

    return NextResponse.json({
      success: true,
      message: results.paymentsFound === 0
        ? 'No payments due for processing'
        : 'Manual payment processing completed',
      results
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    logger.logBatchProcessing(
      'manual-run-payments-error',
      'Error during manual payment processing',
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
