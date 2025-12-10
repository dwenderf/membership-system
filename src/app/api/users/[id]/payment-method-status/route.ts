import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()

  try {
    // Get user's payment method status
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('stripe_payment_method_id, setup_intent_status')
      .eq('id', params.id)
      .single()

    if (userError || !user) {
      return NextResponse.json({
        hasPaymentMethod: false
      })
    }

    // User has valid payment method if both fields exist and setup_intent_status is 'succeeded'
    const hasPaymentMethod = !!(
      user.stripe_payment_method_id &&
      user.setup_intent_status === 'succeeded'
    )

    return NextResponse.json({
      hasPaymentMethod
    })
  } catch (error) {
    console.error('Error checking payment method status:', error)
    return NextResponse.json({
      hasPaymentMethod: false
    })
  }
}
