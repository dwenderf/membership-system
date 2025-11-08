import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AdminHeader from '@/components/AdminHeader'
import { formatAmount } from '@/lib/format-utils'
import PaymentPlansTable from './PaymentPlansTable'

export default async function PaymentPlansReportPage() {
  const supabase = await createClient()

  // Get current authenticated user
  const { data: { user: authUser } } = await supabase.auth.getUser()

  if (!authUser) {
    redirect('/auth/login')
  }

  // Check if user is admin
  const { data: currentUser } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', authUser.id)
    .single()

  if (!currentUser?.is_admin) {
    redirect('/')
  }

  // Fetch initial data directly from database (bypass API for SSR)
  const adminSupabase = createAdminClient()

  // Get all non-deleted users
  const { data: users } = await adminSupabase
    .from('users')
    .select('id, email, first_name, last_name, created_at, payment_plan_enabled')
    .is('deleted_at', null)
    .order('email')

  // Get payment plans
  const userIds = users?.map(u => u.id) || []
  let plansData: any[] = []

  if (userIds.length > 0) {
    const { data: plans } = await adminSupabase
      .from('payment_plan_summary')
      .select('*')
      .in('contact_id', userIds)
      .in('status', ['active', 'completed'])

    plansData = plans || []
  }

  // Organize plans by user
  const plansByUser = new Map<string, any[]>()
  for (const plan of plansData) {
    if (!plansByUser.has(plan.contact_id)) {
      plansByUser.set(plan.contact_id, [])
    }
    plansByUser.get(plan.contact_id)!.push(plan)
  }

  // Calculate summary metrics
  const result = (users || []).map(user => {
    const userPlans = plansByUser.get(user.id) || []
    const activePlans = userPlans.filter(p => p.status === 'active')

    const totalAmount = activePlans.reduce((sum, p) => sum + p.total_amount, 0)
    const paidAmount = activePlans.reduce((sum, p) => sum + p.paid_amount, 0)

    return {
      userId: user.id,
      paymentPlanEnabled: user.payment_plan_enabled || false,
      activePlansCount: activePlans.length,
      remainingBalance: totalAmount - paidAmount
    }
  })

  const totalEligibleUsers = result.filter(u => u.paymentPlanEnabled).length
  const usersWithActivePlans = result.filter(u => u.activePlansCount > 0).length
  const usersWithBalance = result.filter(u => u.remainingBalance > 0).length
  const totalOutstandingBalance = result.reduce((sum, u) => sum + u.remainingBalance, 0)

  const initialData = {
    users: [],
    summary: {
      totalEligibleUsers,
      usersWithActivePlans,
      usersWithBalance,
      totalOutstandingBalance
    }
  }

  return (
    <>
      <AdminHeader title="Payment Plans Report" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">Total Eligible Users</div>
            <div className="mt-1 text-3xl font-semibold text-gray-900">
              {initialData.summary.totalEligibleUsers}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">With Active Plans</div>
            <div className="mt-1 text-3xl font-semibold text-blue-600">
              {initialData.summary.usersWithActivePlans}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">With Balance Due</div>
            <div className="mt-1 text-3xl font-semibold text-orange-600">
              {initialData.summary.usersWithBalance}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">Total Outstanding</div>
            <div className="mt-1 text-3xl font-semibold text-red-600">
              {formatAmount(initialData.summary.totalOutstandingBalance)}
            </div>
          </div>
        </div>

        {/* Table with filters */}
        <PaymentPlansTable initialData={initialData.users} />
      </div>
    </>
  )
}
