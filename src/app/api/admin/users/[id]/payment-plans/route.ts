import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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

    // Get all payment plans for the user
    const { data: plans, error } = await supabase
      .from('payment_plans')
      .select(`
        *,
        user_registration:user_registrations(
          registration:registrations(name, season:seasons(name))
        )
      `)
      .eq('user_id', params.id)
      .order('created_at', { ascending: false })

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
    const formattedPlans = (plans || []).map((plan: any) => ({
      id: plan.id,
      registrationName: plan.user_registration?.registration?.name || 'Unknown',
      seasonName: plan.user_registration?.registration?.season?.name || '',
      totalAmount: plan.total_amount,
      paidAmount: plan.paid_amount,
      remainingBalance: plan.total_amount - plan.paid_amount,
      installmentAmount: plan.installment_amount,
      installmentsCount: plan.installments_count,
      installmentsPaid: plan.installments_paid,
      nextPaymentDate: plan.next_payment_date,
      status: plan.status,
      createdAt: plan.created_at,
      updatedAt: plan.updated_at
    }))

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
