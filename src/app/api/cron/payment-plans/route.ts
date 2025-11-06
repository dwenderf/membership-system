import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { PaymentPlanService } from '@/lib/services/payment-plan-service'
import { emailService } from '@/lib/email/service'

/**
 * Cron Job: Daily Payment Plan Processing
 * Runs daily at 2:06 AM (staggered after cleanup and xero-sync)
 *
 * Responsibilities:
 * 1. Process due payments (scheduled for today or overdue)
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

    // 1. Find transactions due for processing
    // Include: pending transactions due today or earlier, or failed transactions eligible for retry
    const { data: dueTransactions, error: dueError } = await adminSupabase
      .from('payment_plan_transactions')
      .select(`
        *,
        payment_plan:payment_plans(
          *,
          user_registration:user_registrations(
            registration:registrations(name, season:seasons(name))
          )
        )
      `)
      .in('status', ['pending', 'failed'])
      .lte('scheduled_date', today)

    if (dueError) {
      logger.logBatchProcessing(
        'cron-payment-plans-query-error',
        'Error querying due transactions',
        { error: dueError.message },
        'error'
      )
      results.errors.push(`Query error: ${dueError.message}`)
    } else if (dueTransactions && dueTransactions.length > 0) {
      logger.logBatchProcessing(
        'cron-payment-plans-due-found',
        `Found ${dueTransactions.length} transactions due for processing`,
        { count: dueTransactions.length }
      )

      // Filter transactions based on retry eligibility
      const processableTransactions = dueTransactions.filter(tx => {
        // Pending transactions are always processable
        if (tx.status === 'pending' && tx.attempt_count === 0) {
          return true
        }

        // Failed transactions must meet retry criteria
        if (tx.status === 'failed' && tx.attempt_count < tx.max_attempts) {
          // Check if 24 hours have passed since last attempt
          if (tx.last_attempt_at) {
            const lastAttempt = new Date(tx.last_attempt_at)
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
        `${processableTransactions.length} transactions are eligible for processing`,
        {
          total: dueTransactions.length,
          processable: processableTransactions.length,
          skipped: dueTransactions.length - processableTransactions.length
        }
      )

      // Process each eligible transaction
      for (const transaction of processableTransactions) {
        const isRetry = transaction.attempt_count > 0

        if (isRetry) {
          results.retriesAttempted++
        }

        logger.logBatchProcessing(
          'cron-payment-plans-processing-transaction',
          `Processing ${isRetry ? 'retry' : 'initial'} transaction`,
          {
            transactionId: transaction.id,
            installmentNumber: transaction.installment_number,
            attemptCount: transaction.attempt_count,
            isRetry
          }
        )

        const result = await PaymentPlanService.processPaymentPlanTransaction(transaction.id)

        if (result.success) {
          results.paymentsProcessed++

          // Get updated payment plan and user info for email
          const { data: updatedPlan } = await adminSupabase
            .from('payment_plans')
            .select(`
              *,
              user_registration:user_registrations(
                registration:registrations(name, season:seasons(name))
              )
            `)
            .eq('id', transaction.payment_plan.id)
            .single()

          if (updatedPlan) {
            // Get user details
            const { data: user } = await adminSupabase
              .from('users')
              .select('email, first_name, last_name')
              .eq('id', updatedPlan.user_id)
              .single()

            if (user) {
              const userName = `${user.first_name} ${user.last_name}`
              const registrationName = updatedPlan.user_registration?.registration?.name || 'Registration'
              const isFinalPayment = updatedPlan.status === 'completed'

              // Send payment processed email
              try {
                await emailService.sendPaymentPlanPaymentProcessed({
                  userId: updatedPlan.user_id,
                  email: user.email,
                  userName,
                  registrationName,
                  installmentNumber: transaction.installment_number,
                  totalInstallments: updatedPlan.installments_count,
                  installmentAmount: transaction.amount,
                  paymentDate: new Date().toISOString(),
                  amountPaid: updatedPlan.paid_amount,
                  remainingBalance: updatedPlan.total_amount - updatedPlan.paid_amount,
                  nextPaymentDate: updatedPlan.next_payment_date,
                  isFinalPayment
                })

                // Send completion email if this was the final payment
                if (isFinalPayment) {
                  await emailService.sendPaymentPlanCompleted({
                    userId: updatedPlan.user_id,
                    email: user.email,
                    userName,
                    registrationName,
                    totalAmount: updatedPlan.total_amount,
                    totalInstallments: updatedPlan.installments_count,
                    planStartDate: updatedPlan.created_at,
                    completionDate: new Date().toISOString()
                  })
                  results.completionEmailsSent++
                }
              } catch (emailError) {
                logger.logBatchProcessing(
                  'cron-payment-plans-email-error',
                  'Failed to send payment processed email',
                  {
                    transactionId: transaction.id,
                    error: emailError instanceof Error ? emailError.message : String(emailError)
                  },
                  'warn'
                )
                // Don't add to errors - email failures are non-critical
              }
            }
          }

          logger.logBatchProcessing(
            'cron-payment-plans-transaction-success',
            `Successfully processed transaction`,
            {
              transactionId: transaction.id,
              installmentNumber: transaction.installment_number,
              paymentId: result.paymentId
            }
          )
        } else {
          results.paymentsFailed++

          // Get user details for failure email
          const { data: user } = await adminSupabase
            .from('users')
            .select('email, first_name, last_name')
            .eq('id', transaction.payment_plan.user_id)
            .single()

          if (user) {
            const userName = `${user.first_name} ${user.last_name}`
            const registrationName = transaction.payment_plan.user_registration?.registration?.name || 'Registration'
            const remainingRetries = transaction.max_attempts - (transaction.attempt_count + 1)

            // Send failure email
            try {
              await emailService.sendPaymentPlanPaymentFailed({
                userId: transaction.payment_plan.user_id,
                email: user.email,
                userName,
                registrationName,
                installmentNumber: transaction.installment_number,
                totalInstallments: transaction.payment_plan.installments_count,
                installmentAmount: transaction.amount,
                scheduledDate: transaction.scheduled_date,
                failureReason: result.error || 'Payment declined',
                remainingRetries,
                amountPaid: transaction.payment_plan.paid_amount,
                remainingBalance: transaction.payment_plan.total_amount - transaction.payment_plan.paid_amount
              })
            } catch (emailError) {
              logger.logBatchProcessing(
                'cron-payment-plans-failure-email-error',
                'Failed to send payment failure email',
                {
                  transactionId: transaction.id,
                  error: emailError instanceof Error ? emailError.message : String(emailError)
                },
                'warn'
              )
            }
          }

          logger.logBatchProcessing(
            'cron-payment-plans-transaction-failed',
            `Transaction processing failed`,
            {
              transactionId: transaction.id,
              installmentNumber: transaction.installment_number,
              attemptCount: transaction.attempt_count + 1,
              error: result.error
            },
            'warn'
          )

          results.errors.push(`Transaction ${transaction.id}: ${result.error}`)
        }
      }
    }

    // 2. Send pre-notifications for payments due in 3 days
    const { data: upcomingTransactions, error: upcomingError } = await adminSupabase
      .from('payment_plan_transactions')
      .select(`
        *,
        payment_plan:payment_plans(
          *,
          user_registration:user_registrations(
            registration:registrations(name, season:seasons(name))
          )
        )
      `)
      .eq('status', 'pending')
      .eq('scheduled_date', preNotificationDate)

    if (upcomingError) {
      logger.logBatchProcessing(
        'cron-payment-plans-upcoming-query-error',
        'Error querying upcoming transactions',
        { error: upcomingError.message },
        'error'
      )
      results.errors.push(`Upcoming query error: ${upcomingError.message}`)
    } else if (upcomingTransactions && upcomingTransactions.length > 0) {
      logger.logBatchProcessing(
        'cron-payment-plans-upcoming-found',
        `Found ${upcomingTransactions.length} upcoming payments for pre-notification`,
        { count: upcomingTransactions.length }
      )

      for (const transaction of upcomingTransactions) {
        // Get user details
        const { data: user } = await adminSupabase
          .from('users')
          .select('email, first_name, last_name')
          .eq('id', transaction.payment_plan.user_id)
          .single()

        if (user) {
          const userName = `${user.first_name} ${user.last_name}`
          const registrationName = transaction.payment_plan.user_registration?.registration?.name || 'Registration'

          try {
            await emailService.sendPaymentPlanPreNotification({
              userId: transaction.payment_plan.user_id,
              email: user.email,
              userName,
              registrationName,
              installmentNumber: transaction.installment_number,
              totalInstallments: transaction.payment_plan.installments_count,
              installmentAmount: transaction.amount,
              nextPaymentDate: transaction.scheduled_date,
              amountPaid: transaction.payment_plan.paid_amount,
              remainingBalance: transaction.payment_plan.total_amount - transaction.payment_plan.paid_amount
            })

            results.preNotificationsSent++

            logger.logBatchProcessing(
              'cron-payment-plans-pre-notification-sent',
              'Sent pre-notification email',
              {
                transactionId: transaction.id,
                installmentNumber: transaction.installment_number,
                scheduledDate: transaction.scheduled_date
              }
            )
          } catch (emailError) {
            logger.logBatchProcessing(
              'cron-payment-plans-pre-notification-error',
              'Failed to send pre-notification email',
              {
                transactionId: transaction.id,
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
