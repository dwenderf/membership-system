import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

/**
 * Testing Utility: Update Payment Plan Transaction Schedules
 *
 * This endpoint allows you to modify scheduled dates for testing without
 * waiting for the actual monthly intervals.
 *
 * Usage:
 * POST /api/admin/payment-plans/update-schedule
 *
 * Query Parameters:
 * - secret: Admin secret for authorization (required)
 *
 * Body Parameters:
 * {
 *   "transaction_id": "uuid",  // Specific transaction to update
 *   "scheduled_date": "2025-11-03",  // New scheduled date (YYYY-MM-DD)
 *   // OR
 *   "payment_plan_id": "uuid",  // Update all pending transactions for a plan
 *   "days_from_now": 0  // Schedule X days from today (0 = today, 3 = 3 days from now)
 * }
 *
 * Examples:
 * 1. Make next payment due today:
 *    POST /api/admin/payment-plans/update-schedule?secret=YOUR_SECRET
 *    Body: { "transaction_id": "uuid", "days_from_now": 0 }
 *
 * 2. Schedule all pending payments for a plan:
 *    POST /api/admin/payment-plans/update-schedule?secret=YOUR_SECRET
 *    Body: { "payment_plan_id": "uuid", "days_from_now": 0 }
 *
 * 3. Set specific date:
 *    POST /api/admin/payment-plans/update-schedule?secret=YOUR_SECRET
 *    Body: { "transaction_id": "uuid", "scheduled_date": "2025-11-03" }
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
    const body = await request.json()

    const {
      transaction_id,
      payment_plan_id,
      scheduled_date,
      days_from_now
    } = body

    // Calculate target date
    let targetDate: string
    if (scheduled_date) {
      targetDate = scheduled_date
    } else if (days_from_now !== undefined) {
      const date = new Date()
      date.setDate(date.getDate() + days_from_now)
      targetDate = date.toISOString().split('T')[0]
    } else {
      return NextResponse.json({
        error: 'Must provide either scheduled_date or days_from_now'
      }, { status: 400 })
    }

    logger.logAdminAction(
      'payment-plan-schedule-update-start',
      'Updating payment plan transaction schedules',
      {
        transaction_id,
        payment_plan_id,
        targetDate
      }
    )

    // MODE 1: Update specific transaction
    if (transaction_id) {
      const { data: transaction, error: txError } = await adminSupabase
        .from('payment_plan_transactions')
        .update({ scheduled_date: targetDate })
        .eq('id', transaction_id)
        .select(`
          *,
          payment_plan:payment_plans(
            id,
            user_registration:user_registrations(
              registration:registrations(name)
            )
          )
        `)
        .single()

      if (txError) {
        return NextResponse.json({
          error: `Failed to update transaction: ${txError.message}`
        }, { status: 500 })
      }

      logger.logAdminAction(
        'payment-plan-schedule-updated',
        'Updated transaction schedule',
        {
          transaction_id,
          installment_number: transaction.installment_number,
          new_scheduled_date: targetDate
        }
      )

      return NextResponse.json({
        success: true,
        message: 'Transaction schedule updated',
        transaction: {
          id: transaction.id,
          installment_number: transaction.installment_number,
          scheduled_date: transaction.scheduled_date,
          status: transaction.status,
          payment_plan_id: transaction.payment_plan_id
        }
      })
    }

    // MODE 2: Update all pending transactions for a payment plan
    if (payment_plan_id) {
      // Get all pending transactions for this plan, ordered by installment number
      const { data: pendingTransactions, error: fetchError } = await adminSupabase
        .from('payment_plan_transactions')
        .select('*')
        .eq('payment_plan_id', payment_plan_id)
        .in('status', ['pending', 'failed'])
        .order('installment_number')

      if (fetchError) {
        return NextResponse.json({
          error: `Failed to fetch transactions: ${fetchError.message}`
        }, { status: 500 })
      }

      if (!pendingTransactions || pendingTransactions.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No pending transactions to update',
          transactions_updated: 0
        })
      }

      // Update each transaction with scheduled dates 30 days apart
      const updates = []
      for (let i = 0; i < pendingTransactions.length; i++) {
        const tx = pendingTransactions[i]
        const daysOffset = days_from_now + (i * 30)
        const date = new Date()
        date.setDate(date.getDate() + daysOffset)
        const newScheduledDate = date.toISOString().split('T')[0]

        const { error: updateError } = await adminSupabase
          .from('payment_plan_transactions')
          .update({ scheduled_date: newScheduledDate })
          .eq('id', tx.id)

        if (updateError) {
          logger.logAdminAction(
            'payment-plan-schedule-update-error',
            'Failed to update transaction schedule',
            {
              transaction_id: tx.id,
              error: updateError.message
            },
            'error'
          )
        } else {
          updates.push({
            id: tx.id,
            installment_number: tx.installment_number,
            old_date: tx.scheduled_date,
            new_date: newScheduledDate
          })
        }
      }

      // Update payment plan's next_payment_date to the earliest pending date
      if (updates.length > 0) {
        await adminSupabase
          .from('payment_plans')
          .update({ next_payment_date: updates[0].new_date })
          .eq('id', payment_plan_id)
      }

      logger.logAdminAction(
        'payment-plan-schedule-bulk-updated',
        'Updated multiple transaction schedules',
        {
          payment_plan_id,
          count: updates.length
        }
      )

      return NextResponse.json({
        success: true,
        message: `Updated ${updates.length} transactions`,
        transactions_updated: updates.length,
        updates
      })
    }

    return NextResponse.json({
      error: 'Must provide either transaction_id or payment_plan_id'
    }, { status: 400 })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    logger.logAdminAction(
      'payment-plan-schedule-update-error',
      'Error updating payment plan schedules',
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
