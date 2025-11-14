import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

/**
 * GET /api/admin/users/[id]/payment-plans
 * Get all payment plans for a user (for admin view)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()

    // Check if user is admin
    const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser()
    if (authError || !currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: adminCheck } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', currentUser.id)
      .single()

    if (!adminCheck?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Use admin client for querying payment plans (view restricted to service_role)
    const adminSupabase = createAdminClient()

    // Get all payment plans for the user using payment_plan_summary view
    // View includes registration data directly (registration_name, season_name)
    const { data: plans, error } = await adminSupabase
      .from('payment_plan_summary')
      .select('*')
      .eq('contact_id', params.id)

    if (error) {
      logger.logAdminAction(
        'get-user-payment-plans-error',
        'Error fetching user payment plans',
        {
          userId: params.id,
          error: error.message
        },
        'error'
      )
      return NextResponse.json({ error: 'Failed to fetch payment plans' }, { status: 500 })
    }

    // Format the response
    const formattedPlans = (plans || []).map((plan: any) => {
      // Calculate installment amount (total / number of installments)
      const installmentAmount = plan.total_installments > 0
        ? Math.round(plan.total_amount / plan.total_installments)
        : plan.total_amount

      return {
        id: plan.invoice_id,
        registrationName: plan.registration_name || 'Unknown',
        seasonName: plan.season_name || '',
        totalAmount: plan.total_amount,
        paidAmount: plan.paid_amount,
        remainingBalance: plan.total_amount - plan.paid_amount,
        installmentAmount,
        installmentsCount: plan.total_installments,
        installmentsPaid: plan.installments_paid,
        nextPaymentDate: plan.next_payment_date,
        finalPaymentDate: plan.final_payment_date,
        status: plan.status,
        createdAt: null, // payment_plan_summary doesn't include created_at
        updatedAt: null
      }
    })

    return NextResponse.json({
      userId: params.id,
      plans: formattedPlans
    })
  } catch (error) {
    logger.logAdminAction(
      'get-user-payment-plans-exception',
      'Exception fetching user payment plans',
      {
        userId: params.id,
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
