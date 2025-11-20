import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * GET /api/user/payment-plans
 *
 * Fetches active payment plans for the authenticated user.
 * Uses service_role to query payment_plan_summary view (which is restricted to service_role only).
 */
export async function GET() {
  try {
    // Authenticate the user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Use admin client to query the restricted view
    const adminSupabase = await createAdminClient()
    const { data: paymentPlans, error } = await adminSupabase
      .from('payment_plan_summary')
      .select('*')
      .eq('contact_id', user.id)
      .eq('status', 'active')

    if (error) {
      console.error('Error fetching payment plans:', error)
      return NextResponse.json(
        { error: 'Failed to fetch payment plans' },
        { status: 500 }
      )
    }

    return NextResponse.json({ paymentPlans: paymentPlans || [] })
  } catch (error) {
    console.error('Error in payment plans API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
