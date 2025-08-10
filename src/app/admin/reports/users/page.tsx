import { createClient } from '@/lib/supabase/server'
import UsersTable from './UsersTable'

export default async function UsersPage() {
  const supabase = await createClient()

  // Get current authenticated user
  const { data: { user: authUser } } = await supabase.auth.getUser()

  // Fetch all users with basic information, ordered alphabetically by last name, then first name
  const { data: users, error } = await supabase
    .from('users')
    .select(`
      id,
      email,
      first_name,
      last_name,
      member_id,
      is_admin,
      is_goalie,
      is_lgbtq,
      created_at,
      tags
    `)
    .is('deleted_at', null) // Only show active users
    .order('first_name', { ascending: true })
    .order('last_name', { ascending: true })

  if (error) {
    console.error('Error fetching users:', error)
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white shadow rounded-lg p-6 text-center">
          <h2 className="text-xl font-semibold text-red-600 mb-2">Error loading users</h2>
          <p className="text-gray-700 mb-4">There was a problem retrieving the user list. Please try again later or contact support if the issue persists.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Users</h1>
            <p className="mt-1 text-sm text-gray-600">Manage system users and their accounts</p>
          </div>
          {/* Users List */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200 flex flex-col gap-2">
              <h2 className="text-lg font-medium text-gray-900">
                All Users ({users?.length || 0})
              </h2>
              {/* Search box is now inside UsersTable */}
            </div>
            <UsersTable users={users || []} currentUserId={authUser?.id} enableSearch={true} />
          </div>
        </div>
      </div>
    </div>
  )
}
