import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { PaymentPlanService } from '@/lib/services/payment-plan-service'
import { emailService } from '@/lib/email/service'
import { MAX_PAYMENT_ATTEMPTS, RETRY_INTERVAL_HOURS } from '@/lib/services/payment-plan-config'

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

    const adminSupabase = createAdminClient()
    const today = new Date().toISOString().split('T')[0]

    const results = {
      paymentsProcessed: 0,
      paymentsFailed: 0,
      retriesAttempted: 0,
      paymentsFound: 0,
      errors: [] as string[]
    }

    // Find xero_payments due for processing
    // Status='planned' with planned_payment_date <= today
    const { data: duePayments, error: dueError } = await adminSupabase
      .from('xero_payments')
      .select(`
        *,
        xero_invoice:xero_invoices(
          id,
          contact_id,
          user_registrations!inner(
            user_id,
            registration:registrations(name, season:seasons(name))
          )
        )
      `)
      .eq('payment_type', 'installment')
      .eq('sync_status', 'planned')
      .lte('planned_payment_date', today)

    if (dueError) {
      logger.logBatchProcessing(
        'manual-run-payments-query-error',
        'Error querying due payments',
        { error: dueError.message },
        'error'
      )
      results.errors.push(`Query error: ${dueError.message}`)
    } else if (duePayments && duePayments.length > 0) {
      results.paymentsFound = duePayments.length

      logger.logBatchProcessing(
        'manual-run-payments-found',
        `Found ${duePayments.length} payments due for processing`,
        { count: duePayments.length }
      )

      // Filter payments based on retry eligibility
      const processablePayments = duePayments.filter(payment => {
        // Never attempted (first time)
        if (payment.attempt_count === 0) {
          return true
        }

        // Has attempts but under max attempts
        if (payment.attempt_count < MAX_PAYMENT_ATTEMPTS) {
          // Check if retry interval has passed since last attempt
          if (payment.last_attempt_at) {
            const lastAttempt = new Date(payment.last_attempt_at)
            const now = new Date()
            const hoursSinceLastAttempt = (now.getTime() - lastAttempt.getTime()) / (1000 * 60 * 60)
            return hoursSinceLastAttempt >= RETRY_INTERVAL_HOURS
          }
          // If no last_attempt_at, allow processing
          return true
        }

        return false
      })

      logger.logBatchProcessing(
        'manual-run-payments-processable',
        `${processablePayments.length} payments are eligible for processing`,
        {
          total: duePayments.length,
          processable: processablePayments.length,
          skipped: duePayments.length - processablePayments.length
        }
      )

      // Process each eligible payment
      for (const payment of processablePayments) {
        const isRetry = payment.attempt_count > 0
        const invoice = payment.xero_invoice as any
        const userReg = invoice.user_registrations[0]

        if (isRetry) {
          results.retriesAttempted++
        }

        logger.logBatchProcessing(
          'manual-run-payments-processing-payment',
          `Processing ${isRetry ? 'retry' : 'initial'} payment`,
          {
            xeroPaymentId: payment.id,
            installmentNumber: payment.installment_number,
            attemptCount: payment.attempt_count,
            isRetry
          }
        )

        const result = await PaymentPlanService.processPaymentPlanTransaction(payment.id)

        if (result.success) {
          results.paymentsProcessed++

          logger.logBatchProcessing(
            'manual-run-payments-payment-success',
            `Successfully processed payment`,
            {
              xeroPaymentId: payment.id,
              installmentNumber: payment.installment_number,
              paymentId: result.paymentId
            }
          )
        } else {
          results.paymentsFailed++

          logger.logBatchProcessing(
            'manual-run-payments-payment-failed',
            `Payment processing failed`,
            {
              xeroPaymentId: payment.id,
              installmentNumber: payment.installment_number,
              attemptCount: payment.attempt_count + 1,
              error: result.error
            },
            'warn'
          )

          results.errors.push(`Payment ${payment.id}: ${result.error}`)
        }
      }
    } else {
      logger.logBatchProcessing(
        'manual-run-payments-none-found',
        'No payments due for processing',
        { today }
      )
    }

    const hasErrors = results.errors.length > 0

    logger.logBatchProcessing(
      'manual-run-payments-complete',
      'Manual payment processing completed',
      {
        paymentsFound: results.paymentsFound,
        paymentsProcessed: results.paymentsProcessed,
        paymentsFailed: results.paymentsFailed,
        retriesAttempted: results.retriesAttempted,
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
