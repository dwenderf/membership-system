import { createClient } from '@/lib/supabase/server'
import { formatDateString } from '@/lib/date-utils'
import { getRegistrationStatus, getStatusDisplayText, getStatusBadgeStyle } from '@/lib/registration-status'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import RegistrationsList from '@/components/RegistrationsList'

export default async function RegistrationsPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!userProfile?.is_admin) {
    redirect('/dashboard')
  }

  // Get all registrations with their associated season info
  const { data: registrations, error } = await supabase
    .from('registrations')
    .select(`
      *,
      seasons (
        id,
        name,
        type,
        start_date,
        end_date
      )
    `)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching registrations:', error)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Registration Management</h1>
              <p className="mt-1 text-sm text-gray-600">
                Create and manage team registrations and events
              </p>
              {registrations && registrations.length > 0 && (
                <div className="mt-3 flex items-center space-x-4 text-sm">
                  {(() => {
                    const activeCount = registrations.filter((reg: any) => {
                      const status = getRegistrationStatus(reg)
                      return status === 'open' || status === 'presale'
                    }).length
                    const draftCount = registrations.filter((reg: any) => !reg.is_active).length
                    const closedCount = registrations.filter((reg: any) => {
                      const status = getRegistrationStatus(reg)
                      return status === 'expired' || status === 'past'
                    }).length
                    const comingSoonCount = registrations.filter((reg: any) => {
                      const status = getRegistrationStatus(reg)
                      return status === 'coming_soon'
                    }).length

                    return (
                      <>
                        <span className="text-gray-600 font-medium">{draftCount} Draft</span>
                        <span className="text-gray-400">•</span>
                        <span className="text-green-600 font-medium">{activeCount} Active</span>
                        <span className="text-gray-400">•</span>
                        <span className="text-yellow-600 font-medium">{comingSoonCount} Coming Soon</span>
                        <span className="text-gray-400">•</span>
                        <span className="text-red-600 font-medium">{closedCount} Closed</span>
                      </>
                    )
                  })()}
                </div>
              )}
            </div>
            <Link
              href="/admin/registrations/new"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Create New Registration
            </Link>
          </div>

          {/* Registrations List */}
          {!registrations || registrations.length === 0 ? (
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
              <div className="text-center py-12">
                <div className="text-gray-500 text-lg mb-4">No registrations created yet</div>
                <Link
                  href="/admin/registrations/new"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                >
                  Create Your First Registration
                </Link>
              </div>
            </div>
          ) : (
            <RegistrationsList registrations={registrations} />
          )}

          {/* Back to Admin Dashboard */}
          <div className="mt-6">
            <Link
              href="/admin"
              className="text-blue-600 hover:text-blue-500 text-sm font-medium"
            >
              ← Back to Admin Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}