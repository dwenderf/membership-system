import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { PaymentPlanService } from './payment-plan-service'
import { emailService } from '@/lib/email/service'
import { MAX_PAYMENT_ATTEMPTS, RETRY_INTERVAL_HOURS } from './payment-plan-config'

/**
 * Shared Payment Plan Processing Logic
 *
 * This module contains the core payment processing workflow used by both:
 * - The daily cron job (/api/cron/payment-plans)
 * - The manual testing endpoint (/api/admin/payment-plans/run-payments)
 *
 * By centralizing this logic, we ensure both paths behave identically and
 * avoid maintenance issues from duplicated code.
 */

interface ProcessingResults {
  paymentsProcessed: number
  paymentsFailed: number
  retriesAttempted: number
  paymentsFound: number
  completionEmailsSent: number
  preNotificationsSent: number
  errors: string[]
}

/**
 * Process all due payment plan payments
 *
 * This function handles:
 * 1. Finding payments that are due (sync_status='planned' and planned_payment_date <= today)
 * 2. Filtering for retry eligibility based on attempt count and retry interval
 * 3. Processing each payment via PaymentPlanService
 * 4. Sending success/failure emails to users
 * 5. Sending completion emails when final payment is made
 *
 * @param today - The date to use as "today" for queries (format: YYYY-MM-DD)
 * @returns Processing results with counts and any errors
 */
export async function processDuePayments(today: string): Promise<ProcessingResults> {
  const adminSupabase = createAdminClient()

  const results: ProcessingResults = {
    paymentsProcessed: 0,
    paymentsFailed: 0,
    retriesAttempted: 0,
    paymentsFound: 0,
    completionEmailsSent: 0,
    preNotificationsSent: 0,
    errors: []
  }

  // Find xero_payments due for processing
  const { data: duePayments, error: dueError } = await adminSupabase
    .from('xero_payments')
    .select(`
      *,
      xero_invoice:xero_invoices(
        id,
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
      'payment-processor-query-error',
      'Error querying due payments',
      { error: dueError.message },
      'error'
    )
    results.errors.push(`Query error: ${dueError.message}`)
    return results
  }

  if (!duePayments || duePayments.length === 0) {
    logger.logBatchProcessing(
      'payment-processor-none-found',
      'No payments due for processing',
      { today }
    )
    return results
  }

  results.paymentsFound = duePayments.length

  logger.logBatchProcessing(
    'payment-processor-found',
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
    'payment-processor-processable',
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
      'payment-processor-processing-payment',
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
              'payment-processor-email-error',
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
        'payment-processor-payment-success',
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
            'payment-processor-failure-email-error',
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
        'payment-processor-payment-failed',
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

  return results
}

/**
 * Send pre-notifications for upcoming payments (3 days before)
 *
 * @param preNotificationDate - The date to check for upcoming payments (format: YYYY-MM-DD)
 * @returns Number of notifications sent
 */
export async function sendPreNotifications(preNotificationDate: string): Promise<number> {
  const adminSupabase = createAdminClient()
  let notificationsSent = 0

  const { data: upcomingPayments, error: upcomingError } = await adminSupabase
    .from('xero_payments')
    .select(`
      *,
      xero_invoice:xero_invoices(
        id,
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
      'payment-processor-upcoming-query-error',
      'Error querying upcoming payments',
      { error: upcomingError.message },
      'error'
    )
    return 0
  }

  if (!upcomingPayments || upcomingPayments.length === 0) {
    return 0
  }

  logger.logBatchProcessing(
    'payment-processor-upcoming-found',
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

        notificationsSent++

        logger.logBatchProcessing(
          'payment-processor-pre-notification-sent',
          'Sent pre-notification email',
          {
            xeroPaymentId: payment.id,
            installmentNumber: payment.installment_number,
            scheduledDate: payment.planned_payment_date
          }
        )
      } catch (emailError) {
        logger.logBatchProcessing(
          'payment-processor-pre-notification-error',
          'Failed to send pre-notification email',
          {
            xeroPaymentId: payment.id,
            error: emailError instanceof Error ? emailError.message : String(emailError)
          },
          'warn'
        )
        // Don't fail - email failures are non-critical
      }
    }
  }

  return notificationsSent
}
