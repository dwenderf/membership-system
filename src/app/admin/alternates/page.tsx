import { createClient } from '@/lib/supabase/server'
import { checkAlternatesAccess } from '@/lib/utils/alternates-access'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import AlternatesManager from '@/components/AlternatesManager'

export default async function AlternatesPage() {
  // Check access permissions
  const access = await checkAlternatesAccess()
  
  if (!access.hasAccess) {
    if (access.isAdmin === false) {
      redirect('/dashboard') // Not admin
    } else {
      redirect('/auth/login') // Not authenticated
    }
  }

  const supabase = await createClient()

  // Get all non-expired registrations that allow alternates
  const { data: registrations, error } = await supabase
    .from('registrations')
    .select(`
      id,
      name,
      type,
      allow_alternates,
      alternate_price,
      alternate_accounting_code,
      is_active,
      seasons (
        id,
        name,
        end_date
      )
    `)
    .eq('allow_alternates', true)
    .eq('is_active', true)
    .order('name')

  if (error) {
    console.error('Error fetching registrations:', error)
    notFound()
  }

  // Filter out expired registrations (where season has ended)
  const activeRegistrations = registrations?.filter(reg => {
    if (!reg.seasons?.end_date) return true // No end date = always active
    return new Date(reg.seasons.end_date) >= new Date()
  }) || []

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Navigation - Top */}
          <div className="mb-4">
            <Link
              href="/admin"
              className="text-blue-600 hover:text-blue-500 text-sm font-medium"
            >
              ← Back to Admin Dashboard
            </Link>
          </div>

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Alternates Management</h1>
            <p className="mt-2 text-sm text-gray-600">
              Manage alternate players across all active registrations
            </p>
          </div>

          {/* Main Content */}
          {activeRegistrations.length === 0 ? (
            <div className="bg-white shadow rounded-lg p-12 text-center">
              <div className="text-gray-500 text-lg mb-4">No Active Registrations with Alternates</div>
              <p className="text-sm text-gray-600 mb-6">
                Create a registration and enable alternates to start managing alternate players.
              </p>
              <Link
                href="/admin/registrations"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
              >
                Manage Registrations
              </Link>
            </div>
          ) : (
            <AlternatesManager 
              registrations={activeRegistrations}
              userAccess={access}
            />
          )}

          {/* Navigation - Bottom */}
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