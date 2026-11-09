import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Database } from '@/types/database'
import { logger } from '@/lib/logging/logger'

/**
 * Browser-facing payment status updates.
 *
 * The browser may only close out its own pending payment as 'failed' (card
 * declined) or 'cancelled' (form closed, timer expired). 'completed' is set
 * server-side only: by the Stripe webhook, by the confirm-*-payment routes
 * after they retrieve a succeeded PaymentIntent from Stripe, or by the
 * zero-cost flows.
 */
const CLIENT_PAYMENT_STATUSES = ['failed', 'cancelled']

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { stripePaymentIntentId, status } = body
    
    if (!stripePaymentIntentId || !status) {
      return NextResponse.json({ 
        error: 'Missing required fields: stripePaymentIntentId, status' 
      }, { status: 400 })
    }

    if (!CLIENT_PAYMENT_STATUSES.includes(status)) {
      return NextResponse.json({
        error: `Invalid status. Must be one of: ${CLIENT_PAYMENT_STATUSES.join(', ')}`
      }, { status: 400 })
    }

    // Build update object
    const updateData: Database['public']['Tables']['payments']['Update'] = {
      status: status,
      updated_at: new Date().toISOString()
    }

    // Both allowed states are final (the transaction is finished, unsuccessfully).
    updateData.completed_at = new Date().toISOString()

    // Update the payment status
    const { data, error } = await adminSupabase
      .from('payments')
      .update(updateData)
      .eq('stripe_payment_intent_id', stripePaymentIntentId)
      .eq('user_id', user.id) // Ensure user can only update their own payments
      .eq('status', 'pending') // Never rewrite a payment that has already settled
      .select()

    if (error) {
      logger.logPaymentProcessing('payment-status-update-failed', 'Error updating payment status', { stripePaymentIntentId, status, userId: user.id, error: error.message }, 'error')
      return NextResponse.json({
        error: 'Failed to update payment status'
      }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({
        error: 'No payment found to update'
      }, { status: 404 })
    }

    logger.logPaymentProcessing('payment-status-updated', `Updated payment status to '${status}' for payment intent ${stripePaymentIntentId}`, { stripePaymentIntentId, status, userId: user.id }, 'info')

    return NextResponse.json({
      success: true,
      updated: data.length,
      payment: data[0]
    })

  } catch (error) {
    logger.logPaymentProcessing('update-payment-status-error', 'Error updating payment status', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({
      error: 'Internal server error'
    }, { status: 500 })
  }
}