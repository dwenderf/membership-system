'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import UsersTable from './UsersTable'

interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  member_id: number | null
  is_admin: boolean
  is_goalie: boolean
  is_lgbtq: boolean | null
  created_at: string
  tags: string[] | null
  stripe_payment_method_id: string | null
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [authUser, setAuthUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      try {
        const supabase = createClient()

        // Get current authenticated user
        const { data: { user } } = await supabase.auth.getUser()
        setAuthUser(user)

        // Fetch all users with basic information, ordered alphabetically by last name, then first name
        const { data: usersData, error: usersError } = await supabase
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
            tags,
            stripe_payment_method_id
          `)
          .is('deleted_at', null) // Only show active users
          .order('first_name', { ascending: true })
          .order('last_name', { ascending: true })

        if (usersError) {
          console.error('Error fetching users:', usersError)
          setError('There was a problem retrieving the user list. Please try again later or contact support if the issue persists.')
        } else {
          setUsers(usersData || [])
        }
      } catch (err) {
        console.error('Error:', err)
        setError('An unexpected error occurred. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white shadow rounded-lg p-6 text-center">
          <h2 className="text-xl font-semibold text-red-600 mb-2">Error loading users</h2>
          <p className="text-gray-700 mb-4">{error}</p>
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
          {/* Search */}
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          
          {/* Users List */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200 flex flex-col gap-2">
              <h2 className="text-lg font-medium text-gray-900">
                All Users ({users?.length || 0})
              </h2>
            </div>
            <UsersTable users={users || []} currentUserId={authUser?.id} searchTerm={searchTerm} />
          </div>
        </div>
      </div>
    </div>
  )
}
