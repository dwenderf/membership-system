import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { filterActivePlans } from '@/lib/payment-plan-utils'

/**
 * GET /api/admin/payment-plans
 * Get all users and their payment plans
 *
 * Query parameters:
 * - filter: 'all' | 'active' (default: 'all')
 *   - 'all': Show all users
 *   - 'active': Show only users with active payment plans (remaining balance > 0)
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

    // Use admin client for querying payment plans (view restricted to service_role)
    const adminSupabase = createAdminClient()

    // Get filter from query params
    const searchParams = request.nextUrl.searchParams
    const filter = searchParams.get('filter') || 'all'

    // Build query for users (exclude deleted users)
    const { data: users, error: usersError } = await adminSupabase
      .from('users')
      .select('id, email, first_name, last_name, created_at, payment_plan_enabled')
      .is('deleted_at', null)
      .order('email')

    if (usersError) {
      logger.logAdminAction(
        'get-payment-plans-report-error',
        'Error fetching users for payment plans report',
        { error: usersError.message },
        'error'
      )
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
    }

    // Get all payment plans for these users using the payment_plan_summary view
    const userIds = users?.map(u => u.id) || []

    let plansData: any[] = []
    if (userIds.length > 0) {
      // Fetch payment plans from view (includes registration data)
      const { data: plans, error: plansError } = await adminSupabase
        .from('payment_plan_summary')
        .select('*')
        .in('contact_id', userIds)
        .in('status', ['active', 'completed', 'failed'])

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

    // Organize plans by user (contact_id is the user_id in payment_plan_summary)
    const plansByUser = new Map<string, any[]>()
    for (const plan of plansData) {
      if (!plansByUser.has(plan.contact_id)) {
        plansByUser.set(plan.contact_id, [])
      }
      plansByUser.get(plan.contact_id)!.push(plan)
    }

    // Format response
    const result = (users || []).map(user => {
      const userPlans = plansByUser.get(user.id) || []

      // activePlans: Plans that require attention (active or failed status)
      // Used for date calculations since these plans have scheduled/upcoming payments
      const activePlans = filterActivePlans(userPlans)

      // plansWithBalance: Plans with outstanding balance (regardless of status)
      // Used for amount calculations to show accurate remaining balances
      // Note: A 'completed' plan might still have a balance if manually adjusted
      const plansWithBalance = userPlans.filter(p => (p.total_amount - p.paid_amount) > 0)

      const totalAmount = plansWithBalance.reduce((sum, p) => sum + p.total_amount, 0)
      const paidAmount = plansWithBalance.reduce((sum, p) => sum + p.paid_amount, 0)
      const remainingBalance = totalAmount - paidAmount

      // Find next payment date (earliest among all active/failed plans)
      const nextPaymentDates = activePlans
        .map(p => p.next_payment_date)
        .filter(d => d !== null)
        .sort()

      const nextPaymentDate = nextPaymentDates.length > 0 ? nextPaymentDates[0] : null

      // Find final payment date (latest among all active/failed plans)
      let finalPaymentDate = null
      if (activePlans.length > 0) {
        const latestDate = activePlans.reduce((latest, plan) => {
          const planFinalDate = plan.final_payment_date
          if (!latest || (planFinalDate && planFinalDate > latest)) {
            return planFinalDate
          }
          return latest
        }, null as string | null)
        finalPaymentDate = latestDate
      }

      return {
        userId: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        paymentPlanEnabled: user.payment_plan_enabled || false,
        activePlansCount: activePlans.length,
        totalPlansCount: userPlans.length,
        totalAmount,
        paidAmount,
        remainingBalance,
        nextPaymentDate,
        finalPaymentDate,
        plans: userPlans.map(plan => {
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
            installments: plan.installments
          }
        })
      }
    })

    // Calculate summary metrics from all users (before filtering)
    const totalEligibleUsers = result.filter(u => u.paymentPlanEnabled).length
    const usersWithActivePlans = result.filter(u => u.activePlansCount > 0).length
    const usersWithBalance = result.filter(u => u.remainingBalance > 0).length
    const totalOutstandingBalance = result.reduce((sum, u) => sum + u.remainingBalance, 0)

    // Debug logging
    logger.logAdminAction(
      'payment-plans-summary-debug',
      'Payment plans summary calculation',
      {
        totalUsers: result.length,
        totalEligibleUsers,
        usersWithActivePlans,
        usersWithBalance,
        sampleUsers: result.slice(0, 3).map(u => ({
          id: u.userId,
          paymentPlanEnabled: u.paymentPlanEnabled,
          activePlansCount: u.activePlansCount
        }))
      },
      'info'
    )

    // Apply filters if requested
    let filteredResult = result
    if (filter === 'active') {
      filteredResult = result.filter(u => u.remainingBalance > 0)
    } else if (filter === 'eligible') {
      filteredResult = result.filter(u => u.paymentPlanEnabled)
    }

    return NextResponse.json({
      users: filteredResult,
      summary: {
        totalEligibleUsers,
        usersWithActivePlans,
        usersWithBalance,
        totalOutstandingBalance
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

