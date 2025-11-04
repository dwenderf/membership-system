import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

/**
 * GET /api/admin/payment-plans
 * Get all payment plan eligible users and their payment plans
 *
 * Query parameters:
 * - filter: 'all' | 'eligible' | 'active' (default: 'all')
 */
export async function GET(request: NextRequest) {
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

    // Get filter from query params
    const searchParams = request.nextUrl.searchParams
    const filter = searchParams.get('filter') || 'all'

    // Build query for users
    let usersQuery = supabase
      .from('users')
      .select('id, email, first_name, last_name, payment_plan_enabled, created_at')

    // Apply filter
    if (filter === 'eligible') {
      usersQuery = usersQuery.eq('payment_plan_enabled', true)
    }

    const { data: users, error: usersError } = await usersQuery.order('email')

    if (usersError) {
      logger.logAdminAction(
        'get-payment-plans-report-error',
        'Error fetching users for payment plans report',
        { error: usersError.message },
        'error'
      )
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
    }

    // Get all payment plans for these users
    const userIds = users?.map(u => u.id) || []

    let plansData: any[] = []
    if (userIds.length > 0) {
      const { data: plans, error: plansError } = await supabase
        .from('payment_plans')
        .select(`
          *,
          user_registration:user_registrations(
            registration:registrations(name, season:seasons(name))
          )
        `)
        .in('user_id', userIds)
        .in('status', ['active', 'completed'])

      if (plansError) {
        logger.logAdminAction(
          'get-payment-plans-report-plans-error',
          'Error fetching payment plans for report',
          { error: plansError.message },
          'error'
        )
      } else {
        plansData = plans || []
      }
    }

    // Organize plans by user
    const plansByUser = new Map<string, any[]>()
    for (const plan of plansData) {
      if (!plansByUser.has(plan.user_id)) {
        plansByUser.set(plan.user_id, [])
      }
      plansByUser.get(plan.user_id)!.push(plan)
    }

    // Format response
    const result = (users || []).map(user => {
      const userPlans = plansByUser.get(user.id) || []
      const activePlans = userPlans.filter(p => p.status === 'active')

      const totalAmount = activePlans.reduce((sum, p) => sum + p.total_amount, 0)
      const paidAmount = activePlans.reduce((sum, p) => sum + p.paid_amount, 0)
      const remainingBalance = totalAmount - paidAmount

      // Find next payment date (earliest among all active plans)
      const nextPaymentDates = activePlans
        .map(p => p.next_payment_date)
        .filter(d => d !== null)
        .sort()

      const nextPaymentDate = nextPaymentDates.length > 0 ? nextPaymentDates[0] : null

      // Find final payment date (latest among all active plans)
      // Estimate based on remaining installments and 30-day intervals
      let finalPaymentDate = null
      if (activePlans.length > 0) {
        const latestPlan = activePlans.reduce((latest, plan) => {
          const planFinalDate = estimateFinalPaymentDate(plan)
          if (!latest || (planFinalDate && planFinalDate > latest)) {
            return planFinalDate
          }
          return latest
        }, null as string | null)
        finalPaymentDate = latestPlan
      }

      return {
        userId: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        paymentPlanEnabled: user.payment_plan_enabled,
        activePlansCount: activePlans.length,
        totalPlansCount: userPlans.length,
        totalAmount,
        paidAmount,
        remainingBalance,
        nextPaymentDate,
        finalPaymentDate,
        plans: userPlans.map(plan => ({
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
          createdAt: plan.created_at
        }))
      }
    })

    // Apply active balance filter if requested
    let filteredResult = result
    if (filter === 'active') {
      filteredResult = result.filter(u => u.remainingBalance > 0)
    }

    return NextResponse.json({
      users: filteredResult,
      summary: {
        totalUsers: filteredResult.length,
        usersWithActivePlans: filteredResult.filter(u => u.activePlansCount > 0).length,
        usersWithBalance: filteredResult.filter(u => u.remainingBalance > 0).length,
        totalOutstandingBalance: filteredResult.reduce((sum, u) => sum + u.remainingBalance, 0)
      }
    })
  } catch (error) {
    logger.logAdminAction(
      'get-payment-plans-report-exception',
      'Exception fetching payment plans report',
      { error: error instanceof Error ? error.message : String(error) },
      'error'
    )
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Estimate final payment date for a payment plan
 */
function estimateFinalPaymentDate(plan: any): string | null {
  if (!plan.next_payment_date) {
    return null
  }

  const remainingInstallments = plan.installments_count - plan.installments_paid
  if (remainingInstallments <= 0) {
    return null
  }

  // Calculate date based on next payment date + (remaining installments - 1) * 30 days
  const nextDate = new Date(plan.next_payment_date)
  const daysToAdd = (remainingInstallments - 1) * 30
  const finalDate = new Date(nextDate)
  finalDate.setDate(finalDate.getDate() + daysToAdd)

  return finalDate.toISOString().split('T')[0]
}
