import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import SyncButtons from '@/components/admin/SyncButtons'
import AdminDashboardActions from '@/components/admin/AdminDashboardActions'

export default async function AdminDashboard() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  const { data: userData } = user
    ? await supabase.from('users').select('preferences').eq('id', user.id).single()
    : { data: null }

  const preferences = (userData?.preferences as { adminFavorites?: string[] } | null) ?? {}
  const initialFavorites = preferences.adminFavorites ?? []

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <Link href="/user" className="text-sm text-blue-600 hover:text-blue-800">
          &larr; Member View
        </Link>
      </div>

      {/* Manual Sync */}
      <div className="bg-white shadow rounded-lg mb-8">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
            Manual Sync
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Manually sync emails and accounting records. In production, these are also handled automatically by cron jobs.
          </p>
          <SyncButtons />
        </div>
      </div>

      <AdminDashboardActions initialFavorites={initialFavorites} />
    </>
  )
}
