import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

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

    // Validate status
    const validStatuses = ['pending', 'completed', 'failed', 'cancelled']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ 
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      }, { status: 400 })
    }

    // Update the payment status
    const { data, error } = await adminSupabase
      .from('payments')
      .update({ 
        status: status,
        updated_at: new Date().toISOString()
      })
      .eq('stripe_payment_intent_id', stripePaymentIntentId)
      .eq('user_id', user.id) // Ensure user can only update their own payments
      .select()

    if (error) {
      console.error('Error updating payment status:', error)
      return NextResponse.json({ 
        error: 'Failed to update payment status' 
      }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ 
        error: 'No payment found to update' 
      }, { status: 404 })
    }

    console.log(`✅ Updated payment status to '${status}' for payment intent ${stripePaymentIntentId}`)

    return NextResponse.json({ 
      success: true, 
      updated: data.length,
      payment: data[0]
    })
    
  } catch (error) {
    console.error('Error updating payment status:', error)
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}