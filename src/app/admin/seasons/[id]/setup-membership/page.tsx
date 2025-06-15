import { createClient } from '@/lib/supabase/server'
import { formatDateString } from '@/lib/date-utils'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import MembershipSetupForm from './MembershipSetupForm'

export default async function SeasonMembershipSetupPage({
  params,
}: {
  params: { id: string }
}) {
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

  // Get season details
  const { data: season, error } = await supabase
    .from('seasons')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !season) {
    notFound()
  }

  // Get existing memberships that could be assigned to this season
  const { data: availableMemberships } = await supabase
    .from('memberships')
    .select('*')
    .order('created_at', { ascending: false })

  // Get memberships already assigned to this season
  const { data: seasonMemberships } = await supabase
    .from('memberships')
    .select('*')
    .eq('season_id', params.id)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Set Up Membership</h1>
            <p className="mt-1 text-sm text-gray-600">
              Configure membership options for {season.name}
            </p>
          </div>

          {/* Season Info */}
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Season Details</h2>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500">Season Name</dt>
                <dd className="text-sm text-gray-900">{season.name}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Type</dt>
                <dd className="text-sm text-gray-900 capitalize">{season.type.replace('_', '/')}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Start Date</dt>
                <dd className="text-sm text-gray-900">{formatDateString(season.start_date)}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">End Date</dt>
                <dd className="text-sm text-gray-900">{formatDateString(season.end_date)}</dd>
              </div>
            </dl>
          </div>

          {/* Current Memberships */}
          {seasonMemberships && seasonMemberships.length > 0 && (
            <div className="bg-white shadow rounded-lg p-6 mb-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Current Memberships</h2>
              <div className="space-y-3">
                {seasonMemberships.map((membership) => (
                  <div key={membership.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-md">
                    <div>
                      <p className="font-medium text-gray-900">{membership.name}</p>
                      <p className="text-sm text-gray-500">${(membership.price / 100).toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Membership Setup Form */}
          <MembershipSetupForm 
            season={season}
            availableMemberships={availableMemberships || []}
            hasExistingMemberships={seasonMemberships && seasonMemberships.length > 0}
          />

          {/* Navigation */}
          <div className="mt-6 flex justify-between">
            <Link
              href="/admin/seasons"
              className="text-blue-600 hover:text-blue-500 text-sm font-medium"
            >
              ← Back to Seasons
            </Link>
            <Link
              href="/admin/seasons"
              className="text-gray-600 hover:text-gray-500 text-sm font-medium"
            >
              Skip for now →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}