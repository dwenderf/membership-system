import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { PaymentPlanService } from '@/lib/services/payment-plan-service'
import { emailService } from '@/lib/email/service'
import { MAX_PAYMENT_ATTEMPTS } from '@/lib/services/payment-plan-config'

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

    const adminSupabase = createAdminClient()
    const today = new Date().toISOString().split('T')[0]
    const threeDaysFromNow = new Date()
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3)
    const preNotificationDate = threeDaysFromNow.toISOString().split('T')[0]

    const results = {
      paymentsProcessed: 0,
      paymentsFailed: 0,
      retriesAttempted: 0,
      preNotificationsSent: 0,
      completionEmailsSent: 0,
      errors: [] as string[]
    }

    // 1. Find xero_payments due for processing
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
        'cron-payment-plans-query-error',
        'Error querying due payments',
        { error: dueError.message },
        'error'
      )
      results.errors.push(`Query error: ${dueError.message}`)
    } else if (duePayments && duePayments.length > 0) {
      logger.logBatchProcessing(
        'cron-payment-plans-due-found',
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
          // Check if 24 hours have passed since last attempt
          if (payment.last_attempt_at) {
            const lastAttempt = new Date(payment.last_attempt_at)
            const now = new Date()
            const hoursSinceLastAttempt = (now.getTime() - lastAttempt.getTime()) / (1000 * 60 * 60)
            return hoursSinceLastAttempt >= 24
          }
          // If no last_attempt_at, allow processing
          return true
        }

        return false
      })

      logger.logBatchProcessing(
        'cron-payment-plans-processable',
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
          'cron-payment-plans-processing-payment',
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

          // Get updated payment plan summary
          const { data: planSummary } = await adminSupabase
            .from('payment_plan_summary')
            .select('*')
            .eq('invoice_id', invoice.id)
            .single()

          if (planSummary) {
            // Get user details
            const { data: user } = await adminSupabase
              .from('users')
              .select('email, first_name, last_name')
              .eq('id', userReg.user_id)
              .single()

            if (user) {
              const userName = `${user.first_name} ${user.last_name}`
              const registrationName = userReg.registration?.name || 'Registration'
              const isFinalPayment = planSummary.status === 'completed'

              // Send payment processed email
              try {
                await emailService.sendPaymentPlanPaymentProcessed({
                  userId: userReg.user_id,
                  email: user.email,
                  userName,
                  registrationName,
                  installmentNumber: payment.installment_number,
                  totalInstallments: planSummary.total_installments,
                  installmentAmount: payment.amount_paid,
                  paymentDate: new Date().toISOString(),
                  amountPaid: planSummary.paid_amount,
                  remainingBalance: planSummary.total_amount - planSummary.paid_amount,
                  nextPaymentDate: planSummary.next_payment_date,
                  isFinalPayment
                })

                // Send completion email if this was the final payment
                if (isFinalPayment) {
                  await emailService.sendPaymentPlanCompleted({
                    userId: userReg.user_id,
                    email: user.email,
                    userName,
                    registrationName,
                    totalAmount: planSummary.total_amount,
                    totalInstallments: planSummary.total_installments,
                    planStartDate: payment.staging_metadata?.payment_plan_created_at || payment.created_at,
                    completionDate: new Date().toISOString()
                  })
                  results.completionEmailsSent++
                }
              } catch (emailError) {
                logger.logBatchProcessing(
                  'cron-payment-plans-email-error',
                  'Failed to send payment processed email',
                  {
                    xeroPaymentId: payment.id,
                    error: emailError instanceof Error ? emailError.message : String(emailError)
                  },
                  'warn'
                )
                // Don't add to errors - email failures are non-critical
              }
            }
          }

          logger.logBatchProcessing(
            'cron-payment-plans-payment-success',
            `Successfully processed payment`,
            {
              xeroPaymentId: payment.id,
              installmentNumber: payment.installment_number,
              paymentId: result.paymentId
            }
          )
        } else {
          results.paymentsFailed++

          // Get user details for failure email
          const { data: user } = await adminSupabase
            .from('users')
            .select('email, first_name, last_name')
            .eq('id', userReg.user_id)
            .single()

          if (user) {
            const userName = `${user.first_name} ${user.last_name}`
            const registrationName = userReg.registration?.name || 'Registration'
            const remainingRetries = MAX_PAYMENT_ATTEMPTS - (payment.attempt_count + 1)

            // Get payment plan summary for balances
            const { data: planSummary } = await adminSupabase
              .from('payment_plan_summary')
              .select('*')
              .eq('invoice_id', invoice.id)
              .single()

            // Send failure email
            try {
              await emailService.sendPaymentPlanPaymentFailed({
                userId: userReg.user_id,
                email: user.email,
                userName,
                registrationName,
                installmentNumber: payment.installment_number,
                totalInstallments: planSummary?.total_installments || 4,
                installmentAmount: payment.amount_paid,
                scheduledDate: payment.planned_payment_date,
                failureReason: result.error || 'Payment declined',
                remainingRetries,
                amountPaid: planSummary?.paid_amount || 0,
                remainingBalance: planSummary ? (planSummary.total_amount - planSummary.paid_amount) : 0
              })
            } catch (emailError) {
              logger.logBatchProcessing(
                'cron-payment-plans-failure-email-error',
                'Failed to send payment failure email',
                {
                  xeroPaymentId: payment.id,
                  error: emailError instanceof Error ? emailError.message : String(emailError)
                },
                'warn'
              )
            }
          }

          logger.logBatchProcessing(
            'cron-payment-plans-payment-failed',
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
    }

    // 2. Send pre-notifications for payments due in 3 days
    const { data: upcomingPayments, error: upcomingError } = await adminSupabase
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
      .eq('planned_payment_date', preNotificationDate)

    if (upcomingError) {
      logger.logBatchProcessing(
        'cron-payment-plans-upcoming-query-error',
        'Error querying upcoming payments',
        { error: upcomingError.message },
        'error'
      )
      results.errors.push(`Upcoming query error: ${upcomingError.message}`)
    } else if (upcomingPayments && upcomingPayments.length > 0) {
      logger.logBatchProcessing(
        'cron-payment-plans-upcoming-found',
        `Found ${upcomingPayments.length} upcoming payments for pre-notification`,
        { count: upcomingPayments.length }
      )

      for (const payment of upcomingPayments) {
        const invoice = payment.xero_invoice as any
        const userReg = invoice.user_registrations[0]

        // Get user details
        const { data: user } = await adminSupabase
          .from('users')
          .select('email, first_name, last_name')
          .eq('id', userReg.user_id)
          .single()

        if (user) {
          const userName = `${user.first_name} ${user.last_name}`
          const registrationName = userReg.registration?.name || 'Registration'

          // Get payment plan summary for balances
          const { data: planSummary } = await adminSupabase
            .from('payment_plan_summary')
            .select('*')
            .eq('invoice_id', invoice.id)
            .single()

          try {
            await emailService.sendPaymentPlanPreNotification({
              userId: userReg.user_id,
              email: user.email,
              userName,
              registrationName,
              installmentNumber: payment.installment_number,
              totalInstallments: planSummary?.total_installments || 4,
              installmentAmount: payment.amount_paid,
              nextPaymentDate: payment.planned_payment_date,
              amountPaid: planSummary?.paid_amount || 0,
              remainingBalance: planSummary ? (planSummary.total_amount - planSummary.paid_amount) : 0
            })

            results.preNotificationsSent++

            logger.logBatchProcessing(
              'cron-payment-plans-pre-notification-sent',
              'Sent pre-notification email',
              {
                xeroPaymentId: payment.id,
                installmentNumber: payment.installment_number,
                scheduledDate: payment.planned_payment_date
              }
            )
          } catch (emailError) {
            logger.logBatchProcessing(
              'cron-payment-plans-pre-notification-error',
              'Failed to send pre-notification email',
              {
                xeroPaymentId: payment.id,
                error: emailError instanceof Error ? emailError.message : String(emailError)
              },
              'warn'
            )
            // Don't add to errors - email failures are non-critical
          }
        }
      }
    }

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
