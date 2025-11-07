import { createClient } from '@/lib/supabase/server'
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

  // Fetch initial data (all users)
  const response = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/admin/payment-plans?filter=all`, {
    cache: 'no-store'
  })

  let initialData = { users: [], summary: { totalEligibleUsers: 0, usersWithActivePlans: 0, usersWithBalance: 0, totalOutstandingBalance: 0 } }
  if (response.ok) {
    initialData = await response.json()
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
