import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PaymentPlanService } from '@/lib/services/payment-plan-service'
import { logger } from '@/lib/logging/logger'
import { emailService } from '@/lib/email/service'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paymentPlanId = params.id

    // Verify the payment plan belongs to this user
    const { data: paymentPlan, error: planError } = await supabase
      .from('payment_plans')
      .select(`
        *,
        user_registration:user_registrations(
          registration:registrations(name, season:seasons(name))
        )
      `)
      .eq('id', paymentPlanId)
      .eq('user_id', user.id)
      .single()

    if (planError || !paymentPlan) {
      logger.logPaymentProcessing(
        'early-payoff-plan-not-found',
        'Payment plan not found or unauthorized',
        {
          userId: user.id,
          paymentPlanId
        },
        'warn'
      )
      return NextResponse.json({ error: 'Payment plan not found' }, { status: 404 })
    }

    if (paymentPlan.status !== 'active') {
      return NextResponse.json({
        error: 'Payment plan is not active',
        status: paymentPlan.status
      }, { status: 400 })
    }

    const remainingBalance = paymentPlan.total_amount - paymentPlan.paid_amount

    if (remainingBalance <= 0) {
      return NextResponse.json({
        error: 'No remaining balance to pay off'
      }, { status: 400 })
    }

    logger.logPaymentProcessing(
      'early-payoff-start',
      'Processing early payoff request',
      {
        userId: user.id,
        paymentPlanId,
        remainingBalance
      },
      'info'
    )

    // Process the early payoff
    const result = await PaymentPlanService.processEarlyPayoff(paymentPlanId, user.id)

    if (!result.success) {
      logger.logPaymentProcessing(
        'early-payoff-failed',
        'Early payoff processing failed',
        {
          userId: user.id,
          paymentPlanId,
          error: result.error
        },
        'error'
      )
      return NextResponse.json({
        error: result.error || 'Failed to process early payoff'
      }, { status: 400 })
    }

    // Send completion email
    try {
      const { data: userProfile } = await supabase
        .from('users')
        .select('email, first_name, last_name')
        .eq('id', user.id)
        .single()

      if (userProfile) {
        const userName = `${userProfile.first_name} ${userProfile.last_name}`
        const registrationName = paymentPlan.user_registration?.registration?.name || 'Registration'

        await emailService.sendPaymentPlanCompleted({
          userId: user.id,
          email: userProfile.email,
          userName,
          registrationName,
          totalAmount: paymentPlan.total_amount,
          totalInstallments: paymentPlan.installments_count,
          planStartDate: paymentPlan.created_at,
          completionDate: new Date().toISOString()
        })
      }
    } catch (emailError) {
      // Email failure is non-critical
      logger.logPaymentProcessing(
        'early-payoff-email-failed',
        'Failed to send completion email for early payoff',
        {
          userId: user.id,
          paymentPlanId,
          error: emailError instanceof Error ? emailError.message : String(emailError)
        },
        'warn'
      )
    }

    logger.logPaymentProcessing(
      'early-payoff-success',
      'Successfully processed early payoff',
      {
        userId: user.id,
        paymentPlanId,
        amountPaid: result.totalPaid,
        paymentId: result.paymentId
      },
      'info'
    )

    return NextResponse.json({
      success: true,
      paymentId: result.paymentId,
      amountPaid: result.totalPaid
    })

  } catch (error) {
    logger.logPaymentProcessing(
      'early-payoff-exception',
      'Exception during early payoff processing',
      {
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )
    return NextResponse.json({
      error: 'Internal server error'
    }, { status: 500 })
  }
}
