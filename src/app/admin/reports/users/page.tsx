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
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })

  if (error) {
    console.error('Error fetching users:', error)
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          <div className="px-4 py-6 sm:px-0">
            <AdminHeader title="Users" description="Manage system users" />
            <div className="bg-white shadow rounded-lg p-6">
              <div className="text-center text-red-600">
                Error loading users. Please try again.
              </div>
            </div>
          </div>
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
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">
                All Users ({users?.length || 0})
              </h2>
            </div>
            
            {users && users.length > 0 ? (
              <UsersTable users={users} currentUserId={authUser?.id} />
            ) : (
              <div className="px-6 py-8 text-center">
                <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-gray-100 mb-4">
                  <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Users Found</h3>
                <p className="text-gray-600">
                  There are no users in the system yet.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
