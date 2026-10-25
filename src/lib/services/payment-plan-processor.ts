import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { PaymentPlanService } from './payment-plan-service'
import { emailStagingManager } from '@/lib/email/staging'
import { EMAIL_EVENTS } from '@/lib/email/service'
import { MAX_PAYMENT_ATTEMPTS, PAYMENT_PLAN_INSTALLMENTS, RETRY_INTERVAL_HOURS, RETRY_INTERVAL_GRACE_HOURS } from './payment-plan-config'
import { stageAdminPaymentPlanFailureNotification } from '@/lib/email/admin-notifications'
import { formatDate, formatDateString } from '@/lib/date-utils'
import { formatAmount } from '@/lib/format-utils'

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

/** Shape of the `xero_invoice` relation as selected below — not the full DB row,
 * just the nested fields queried and read downstream. */
interface DuePaymentInvoiceJoin {
  id: string
  user_registrations: Array<{
    user_id: string
    registration: { name: string; season: { name: string } | null } | null
  }>
}

export interface ProcessingResults {
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
 * @param options.includeExhausted - Admin-initiated runs only. Also attempt payments that have
 *   used up MAX_PAYMENT_ATTEMPTS or are inside the retry interval. The daily cron never sets this,
 *   so a card that keeps failing is not charged forever without a person deciding to try again.
 * @param options.onlyPaymentIds - Restrict the run to these xero_payments ids (used by the admin
 *   "retry this installment" button).
 * @returns Processing results with counts and any errors
 */
export async function processDuePayments(
  today: string,
  options: { includeExhausted?: boolean; onlyPaymentIds?: string[] } = {}
): Promise<ProcessingResults> {
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
  let dueQuery = adminSupabase
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

  if (options.onlyPaymentIds) {
    dueQuery = dueQuery.in('id', options.onlyPaymentIds)
  }

  const { data: duePayments, error: dueError } = await dueQuery

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
    // Admin "Run Payments": retry everything that is due, including payments that
    // have exhausted their automatic attempts
    if (options.includeExhausted) {
      return true
    }

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
        // The cron fires at the same time every day but each attempt is stamped a few
        // seconds after it starts, so the next run can land just under 24h later and
        // would otherwise skip a whole day. The grace window absorbs that drift.
        return hoursSinceLastAttempt >= RETRY_INTERVAL_HOURS - RETRY_INTERVAL_GRACE_HOURS
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
    const invoice = payment.xero_invoice as DuePaymentInvoiceJoin
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

          // Stage payment processed email
          try {
            await emailStagingManager.stageEmail({
              user_id: userReg.user_id,
              email_address: user.email,
              event_type: EMAIL_EVENTS.PAYMENT_PLAN_PAYMENT_PROCESSED,
              subject: `Payment Plan Payment ${isFinalPayment ? 'Complete' : 'Processed'}`,
              template_id: process.env.LOOPS_PAYMENT_PLAN_PAYMENT_PROCESSED_TEMPLATE_ID,
              email_data: {
                user_name: userName,
                registration_name: registrationName,
                installment_number: payment.installment_number,
                total_installments: planSummary.total_installments,
                installment_amount: formatAmount(payment.amount_paid),
                payment_date: formatDate(new Date()),
                amount_paid: formatAmount(planSummary.paid_amount),
                remaining_balance: formatAmount(planSummary.total_amount - planSummary.paid_amount),
                next_payment_date: planSummary.next_payment_date ? formatDateString(planSummary.next_payment_date) : 'None',
                is_final_payment: isFinalPayment,
                account_settings_url: `${process.env.NEXT_PUBLIC_SITE_URL}/user/account`,
                dashboard_url: `${process.env.NEXT_PUBLIC_SITE_URL}/user`,
                dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/user`
              },
              triggered_by: 'automated',
              related_entity_type: 'payments',
              related_entity_id: payment.id,
              payment_id: payment.id
            })

            // Stage completion email if this was the final payment
            if (isFinalPayment) {
              await emailStagingManager.stageEmail({
                user_id: userReg.user_id,
                email_address: user.email,
                event_type: EMAIL_EVENTS.PAYMENT_PLAN_COMPLETED,
                subject: 'Payment Plan Completed!',
                template_id: process.env.LOOPS_PAYMENT_PLAN_COMPLETED_TEMPLATE_ID,
                email_data: {
                  user_name: userName,
                  registration_name: registrationName,
                  total_amount: formatAmount(planSummary.total_amount),
                  total_installments: planSummary.total_installments,
                  plan_start_date: formatDate(new Date(payment.staging_metadata?.payment_plan_created_at || payment.created_at)),
                  completion_date: formatDate(new Date()),
                  dashboard_url: `${process.env.NEXT_PUBLIC_SITE_URL}/user`,
                  dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/user`
                },
                triggered_by: 'automated',
                related_entity_type: 'payments',
                related_entity_id: payment.id,
                payment_id: payment.id
              })
              results.completionEmailsSent++
            }
          } catch (emailError) {
            logger.logBatchProcessing(
              'payment-processor-email-error',
              'Failed to stage payment processed email',
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
    } else if (result.skipped) {
      // Not a failure: the row stopped being chargeable (early payoff claimed it, another run
      // claimed it, or a payoff is in flight). No member/admin failure notifications (#452).
      logger.logBatchProcessing(
        'payment-processor-payment-skipped',
        'Skipped installment that is no longer chargeable',
        { xeroPaymentId: payment.id, reason: result.error }
      )
    } else {
      results.paymentsFailed++

      // Payment plan summary for balances (member failure email + admin alert)
      const { data: planSummary } = await adminSupabase
        .from('payment_plan_summary')
        .select('*')
        .eq('invoice_id', invoice.id)
        .single()

      // Get user details for failure email
      const { data: user } = await adminSupabase
        .from('users')
        .select('email, first_name, last_name')
        .eq('id', userReg.user_id)
        .single()

      if (user) {
        const userName = `${user.first_name} ${user.last_name}`
        const registrationName = userReg.registration?.name || 'Registration'
        const remainingRetries = Math.max(0, MAX_PAYMENT_ATTEMPTS - (payment.attempt_count + 1))

        // Stage failure email
        try {
          await emailStagingManager.stageEmail({
            user_id: userReg.user_id,
            email_address: user.email,
            event_type: EMAIL_EVENTS.PAYMENT_PLAN_PAYMENT_FAILED,
            subject: 'Payment Plan Payment Failed',
            template_id: process.env.LOOPS_PAYMENT_PLAN_PAYMENT_FAILED_TEMPLATE_ID,
            email_data: {
              user_name: userName,
              registration_name: registrationName,
              installment_number: payment.installment_number,
              total_installments: planSummary?.total_installments || 4,
              installment_amount: formatAmount(payment.amount_paid),
              scheduled_date: formatDateString(payment.planned_payment_date),
              failure_reason: result.error || 'Payment declined',
              remaining_retries: remainingRetries,
              amount_paid: formatAmount(planSummary?.paid_amount || 0),
              remaining_balance: formatAmount(planSummary ? (planSummary.total_amount - planSummary.paid_amount) : 0),
              account_settings_url: `${process.env.NEXT_PUBLIC_SITE_URL}/user/account`
            },
            triggered_by: 'automated',
            related_entity_type: 'payments',
            related_entity_id: payment.id,
            payment_id: payment.id
          })
        } catch (emailError) {
          logger.logBatchProcessing(
            'payment-processor-failure-email-error',
            'Failed to stage payment failure email',
            {
              xeroPaymentId: payment.id,
              error: emailError instanceof Error ? emailError.message : String(emailError)
            },
            'warn'
          )
        }
      }

      const attemptNumber = payment.attempt_count + 1
      const retriesExhausted = attemptNumber >= MAX_PAYMENT_ATTEMPTS

      // Logged as a warning, not an error: a declined card is an expected outcome and
      // admins are told by email (below) rather than through Sentry.
      logger.logBatchProcessing(
        retriesExhausted ? 'payment-processor-payment-retries-exhausted' : 'payment-processor-payment-failed',
        retriesExhausted
          ? 'Payment plan installment failed and automatic retries are exhausted'
          : 'Payment processing failed',
        {
          xeroPaymentId: payment.id,
          userId: userReg.user_id,
          installmentNumber: payment.installment_number,
          attemptCount: attemptNumber,
          maxAttempts: MAX_PAYMENT_ATTEMPTS,
          retriesExhausted,
          error: result.error
        },
        'warn'
      )

      const paidCents = planSummary?.paid_amount || 0
      const remainingCents = planSummary ? (planSummary.total_amount - planSummary.paid_amount) : 0

      await stageAdminPaymentPlanFailureNotification({
        playerUserId: userReg.user_id,
        registrationName: userReg.registration?.name || 'Registration',
        seasonName: userReg.registration?.season?.name || '',
        installmentNumber: payment.installment_number,
        totalInstallments: PAYMENT_PLAN_INSTALLMENTS,
        installmentAmountCents: payment.amount_paid,
        failureReason: result.error || 'Payment declined',
        attemptNumber,
        maxAttempts: MAX_PAYMENT_ATTEMPTS,
        // Same source and formatting as the member failure email above
        scheduledDate: formatDateString(payment.planned_payment_date),
        amountPaidCents: paidCents,
        remainingBalanceCents: remainingCents
      })

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
    const invoice = payment.xero_invoice as DuePaymentInvoiceJoin
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
        await emailStagingManager.stageEmail({
          user_id: userReg.user_id,
          email_address: user.email,
          event_type: EMAIL_EVENTS.PAYMENT_PLAN_PRE_NOTIFICATION,
          subject: 'Upcoming Payment Plan Payment',
          template_id: process.env.LOOPS_PAYMENT_PLAN_PRE_NOTIFICATION_TEMPLATE_ID,
          email_data: {
            user_name: userName,
            registration_name: registrationName,
            installment_number: payment.installment_number,
            total_installments: planSummary?.total_installments || 4,
            installment_amount: formatAmount(payment.amount_paid),
            next_payment_date: formatDateString(payment.planned_payment_date),
            amount_paid: formatAmount(planSummary?.paid_amount || 0),
            remaining_balance: formatAmount(planSummary ? (planSummary.total_amount - planSummary.paid_amount) : 0),
            account_settings_url: `${process.env.NEXT_PUBLIC_SITE_URL}/user/account`
          },
          triggered_by: 'automated',
          related_entity_type: 'payments',
          related_entity_id: payment.id,
          payment_id: payment.id
        })

        notificationsSent++

        logger.logBatchProcessing(
          'payment-processor-pre-notification-staged',
          'Staged pre-notification email',
          {
            xeroPaymentId: payment.id,
            installmentNumber: payment.installment_number,
            scheduledDate: payment.planned_payment_date
          }
        )
      } catch (emailError) {
        logger.logBatchProcessing(
          'payment-processor-pre-notification-error',
          'Failed to stage pre-notification email',
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
