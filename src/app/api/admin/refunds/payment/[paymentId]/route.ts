import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Logger } from '@/lib/logging/logger'

// GET /api/admin/refunds/payment/[paymentId] - Get refund history for payment
export async function GET(
  request: NextRequest,
  { params }: { params: { paymentId: string } }
) {
  const supabase = await createClient()
  const logger = Logger.getInstance()

  try {
    // Check if current user is admin
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
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Validate payment exists
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('id, final_amount, user_id')
      .eq('id', params.paymentId)
      .single()

    if (paymentError || !payment) {
      logger.logSystem('refund-history-error', 'Payment not found', { 
        paymentId: params.paymentId,
        error: paymentError?.message 
      })
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // Get refunds for this payment with user details
    const { data: refunds, error: refundsError } = await supabase
      .from('refunds')
      .select(`
        *,
        processed_by_user:processed_by(first_name, last_name, email)
      `)
      .eq('payment_id', params.paymentId)
      .order('created_at', { ascending: false })

    if (refundsError) {
      logger.logSystem('refund-history-error', 'Failed to fetch refunds', { 
        paymentId: params.paymentId,
        error: refundsError.message 
      })
      return NextResponse.json({ error: 'Failed to fetch refunds' }, { status: 500 })
    }

    // Calculate refund summary
    const totalRefunded = refunds?.reduce((sum, refund) => {
      // Only count completed refunds
      return refund.status === 'completed' ? sum + refund.amount : sum
    }, 0) || 0

    const availableForRefund = payment.final_amount - totalRefunded

    return NextResponse.json({
      success: true,
      refunds: refunds || [],
      summary: {
        paymentAmount: payment.final_amount,
        totalRefunded,
        availableForRefund,
        refundCount: refunds?.length || 0
      }
    })

  } catch (error) {
    logger.logSystem('refund-history-error', 'Unexpected error fetching refund history', { 
      paymentId: params.paymentId,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}