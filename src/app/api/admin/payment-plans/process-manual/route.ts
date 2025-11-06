import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { PaymentPlanService } from '@/lib/services/payment-plan-service'
import { emailService } from '@/lib/email/service'
import { MAX_PAYMENT_ATTEMPTS } from '@/lib/services/payment-plan-config'

/**
 * Manual Testing Endpoint for Payment Plans
 *
 * This endpoint allows you to manually trigger payment plan processing
 * without waiting for the daily cron job or actual scheduled dates.
 *
 * Usage:
 * POST /api/admin/payment-plans/process-manual
 *
 * Query Parameters:
 * - override_date: Override the "today" date for testing (format: YYYY-MM-DD)
 * - transaction_id: Process a specific transaction regardless of date
 * - secret: Admin secret for authorization
 *
 * Examples:
 * 1. Process all payments as if it's a specific date:
 *    POST /api/admin/payment-plans/process-manual?override_date=2025-02-15&secret=YOUR_SECRET
 *
 * 2. Process a specific transaction immediately:
 *    POST /api/admin/payment-plans/process-manual?transaction_id=UUID&secret=YOUR_SECRET
 *
 * 3. Process all overdue payments (no date override):
 *    POST /api/admin/payment-plans/process-manual?secret=YOUR_SECRET
 */
export async function POST(request: NextRequest) {
  try {
    // Authorization check
    const searchParams = request.nextUrl.searchParams
    const secret = searchParams.get('secret')

    if (secret !== process.env.ADMIN_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminSupabase = createAdminClient()
    const overrideDate = searchParams.get('override_date')
    const specificTransactionId = searchParams.get('transaction_id')

    const today = overrideDate || new Date().toISOString().split('T')[0]
    const threeDaysFromToday = new Date(today)
    threeDaysFromToday.setDate(threeDaysFromToday.getDate() + 3)
    const preNotificationDate = threeDaysFromToday.toISOString().split('T')[0]

    logger.logBatchProcessing(
      'manual-payment-plan-processing-start',
      'Starting manual payment plan processing',
      {
        overrideDate: today,
        specificTransactionId
      }
    )

    const results = {
      mode: specificTransactionId ? 'specific_transaction' : 'date_based',
      dateUsed: today,
      paymentsProcessed: 0,
      paymentsFailed: 0,
      retriesAttempted: 0,
      preNotificationsSent: 0,
      completionEmailsSent: 0,
      transactionsFound: 0,
      errors: [] as string[]
    }

    // MODE 1: Process a specific transaction
    if (specificTransactionId) {
      logger.logBatchProcessing(
        'manual-processing-specific-transaction',
        'Processing specific transaction',
        { transactionId: specificTransactionId }
      )

      const { data: transaction, error: txError } = await adminSupabase
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
        .eq('id', specificTransactionId)
        .single()

      if (txError || !transaction) {
        results.errors.push(`Transaction not found: ${specificTransactionId}`)
        return NextResponse.json({
          success: false,
          error: 'Transaction not found',
          results
        }, { status: 404 })
      }

      results.transactionsFound = 1

      const isRetry = transaction.attempt_count > 0
      if (isRetry) {
        results.retriesAttempted++
      }

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
          }
        }
      } else {
        results.paymentsFailed++
        results.errors.push(`Transaction ${transaction.id}: ${result.error}`)
      }

      return NextResponse.json({
        success: true,
        message: 'Manual processing completed',
        results
      })
    }

    // MODE 2: Process all due transactions (with optional date override)
    logger.logBatchProcessing(
      'manual-processing-date-based',
      'Processing date-based transactions',
      { today }
    )

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
      results.errors.push(`Query error: ${dueError.message}`)
    } else if (dueTransactions && dueTransactions.length > 0) {
      results.transactionsFound = dueTransactions.length

      // Filter transactions based on retry eligibility (unless date is overridden)
      const processableTransactions = overrideDate
        ? dueTransactions // If date is overridden, process all
        : dueTransactions.filter(tx => {
            if (tx.status === 'pending' && tx.attempt_count === 0) {
              return true
            }
            if (tx.status === 'failed' && tx.attempt_count < MAX_PAYMENT_ATTEMPTS) {
              if (tx.last_attempt_at) {
                const lastAttempt = new Date(tx.last_attempt_at)
                const now = new Date()
                const hoursSinceLastAttempt = (now.getTime() - lastAttempt.getTime()) / (1000 * 60 * 60)
                return hoursSinceLastAttempt >= 24
              }
              return true
            }
            return false
          })

      logger.logBatchProcessing(
        'manual-processing-filtered',
        `Processing ${processableTransactions.length} of ${dueTransactions.length} transactions`,
        {
          total: dueTransactions.length,
          processable: processableTransactions.length
        }
      )

      // Process each transaction
      for (const transaction of processableTransactions) {
        const isRetry = transaction.attempt_count > 0
        if (isRetry) {
          results.retriesAttempted++
        }

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
            const { data: user } = await adminSupabase
              .from('users')
              .select('email, first_name, last_name')
              .eq('id', updatedPlan.user_id)
              .single()

            if (user) {
              const userName = `${user.first_name} ${user.last_name}`
              const registrationName = updatedPlan.user_registration?.registration?.name || 'Registration'
              const isFinalPayment = updatedPlan.status === 'completed'

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
            }
          }
        } else {
          results.paymentsFailed++

          const { data: user } = await adminSupabase
            .from('users')
            .select('email, first_name, last_name')
            .eq('id', transaction.payment_plan.user_id)
            .single()

          if (user) {
            const userName = `${user.first_name} ${user.last_name}`
            const registrationName = transaction.payment_plan.user_registration?.registration?.name || 'Registration'
            const remainingRetries = MAX_PAYMENT_ATTEMPTS - (transaction.attempt_count + 1)

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
          }

          results.errors.push(`Transaction ${transaction.id}: ${result.error}`)
        }
      }
    }

    // Send pre-notifications for upcoming payments
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
      results.errors.push(`Upcoming query error: ${upcomingError.message}`)
    } else if (upcomingTransactions && upcomingTransactions.length > 0) {
      for (const transaction of upcomingTransactions) {
        const { data: user } = await adminSupabase
          .from('users')
          .select('email, first_name, last_name')
          .eq('id', transaction.payment_plan.user_id)
          .single()

        if (user) {
          const userName = `${user.first_name} ${user.last_name}`
          const registrationName = transaction.payment_plan.user_registration?.registration?.name || 'Registration'

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
        }
      }
    }

    logger.logBatchProcessing(
      'manual-payment-plan-processing-complete',
      'Manual payment plan processing completed',
      results
    )

    return NextResponse.json({
      success: true,
      message: 'Manual processing completed',
      results
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    logger.logBatchProcessing(
      'manual-payment-plan-processing-error',
      'Error during manual processing',
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
