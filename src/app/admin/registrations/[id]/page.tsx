import { createClient } from '@/lib/supabase/server'
import { formatDateString } from '@/lib/date-utils'
import ClientTimestamp from '@/components/ClientTimestamp'
import { getCategoryDisplayName, isCategoryCustom } from '@/lib/registration-utils'
import { getRegistrationStatus, getStatusDisplayText, getStatusBadgeStyle } from '@/lib/registration-status'
import { getCategoryRegistrationCounts } from '@/lib/registration-counts'
import RegistrationCategoriesDndList from '@/components/RegistrationCategoriesDndList'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import EditableRegistrationName from '@/components/EditableRegistrationName'
import EditableAlternateConfiguration from '@/components/EditableAlternateConfiguration'
import GamesPreview from '@/components/GamesPreview'

export default async function RegistrationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
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

  // Get registration details with season info
  const { data: registration, error } = await supabase
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
    .eq('id', id)
    .single()

  if (error || !registration) {
    notFound()
  }

  // Get registration categories with joined category and membership data
  const { data: categories, error: categoriesError } = await supabase
    .from('registration_categories')
    .select(`
      *,
      categories (
        id,
        name,
        description,
        category_type
      ),
      memberships (
        id,
        name
      )
    `)
    .eq('registration_id', id)
    .order('sort_order', { ascending: true })

  // Get paid registration counts for each category
  const categoryIds = categories?.map(cat => cat.id) || []
  const categoryRegistrationCounts = await getCategoryRegistrationCounts(categoryIds)

  if (categoriesError) {
    console.error('Error fetching categories:', categoriesError)
  }

  const season = registration.seasons
  const isSeasonEnded = season && new Date(season.end_date) < new Date()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-3 mb-2">
                  <EditableRegistrationName
                    registrationId={id}
                    initialName={registration.name}
                  />
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeStyle(getRegistrationStatus(registration))
                    }`}>
                    {getStatusDisplayText(getRegistrationStatus(registration))}
                  </span>
                  {!registration.is_active && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                      Not Published
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  Registration details and category management
                </p>
              </div>
            </div>

            {/* Unpublished Alert */}
            {!registration.is_active && (
              <div className="mt-4 bg-yellow-50 border-l-4 border-yellow-400 p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-yellow-700">
                      {!categories || categories.length === 0 ? (
                        <>This registration is not published. You need to add at least one category before you can configure timing and publish.</>
                      ) : (
                        <>This registration is not published. Configure registration timing and publish to make it visible to users.</>
                      )}
                    </p>
                    <div className="mt-2">
                      {!categories || categories.length === 0 ? (
                        <Link
                          href={`/admin/registrations/${id}/categories/new`}
                          className="inline-flex items-center text-sm font-medium text-yellow-700 hover:text-yellow-600"
                        >
                          Add Category →
                        </Link>
                      ) : (
                        <Link
                          href={`/admin/registrations/${id}/timing`}
                          className="inline-flex items-center text-sm font-medium text-yellow-700 hover:text-yellow-600"
                        >
                          Configure & Publish →
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Registration Details */}
            <div className="lg:col-span-1">
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">Registration Details</h2>
                <dl className="space-y-4">
                  {/* ...existing code for registration details... */}
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Type</dt>
                    <dd className="mt-1 text-sm text-gray-900 capitalize">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${registration.type === 'team' ? 'bg-blue-100 text-blue-800' :
                        registration.type === 'scrimmage' ? 'bg-green-100 text-green-800' :
                          'bg-purple-100 text-purple-800'
                        }`}>
                        {registration.type}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Season</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {season?.name}
                      {isSeasonEnded && (
                        <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                          Ended
                        </span>
                      )}
                    </dd>
                  </div>
                  {season && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Season Dates</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        {formatDateString(season.start_date)} - {formatDateString(season.end_date)}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Discount Codes</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {registration.allow_discounts ? (
                        <span className="text-green-600">Allowed</span>
                      ) : (
                        <span className="text-red-600">Not Allowed</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Alternates</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      <EditableAlternateConfiguration
                        registrationId={id}
                        initialConfig={{
                          allow_alternates: registration.allow_alternates || false,
                          alternate_price: registration.alternate_price,
                          alternate_accounting_code: registration.alternate_accounting_code
                        }}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-500">Registration Timing</span>
                      <Link
                        href={`/admin/registrations/${id}/timing`}
                        className="text-xs text-blue-600 hover:text-blue-500 font-medium"
                      >
                        Edit
                      </Link>
                    </dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {registration.presale_start_at || registration.regular_start_at || registration.registration_end_at ? (
                        <div className="space-y-1">
                          {registration.presale_start_at && (
                            <div>
                              <span className="font-medium">Pre-sale:</span> <ClientTimestamp timestamp={registration.presale_start_at} />
                              {registration.presale_code && (
                                <span className="ml-2 text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded">
                                  Code: {registration.presale_code.toUpperCase()}
                                </span>
                              )}
                            </div>
                          )}
                          {registration.regular_start_at && (
                            <div>
                              <span className="font-medium">General:</span> <ClientTimestamp timestamp={registration.regular_start_at} />
                            </div>
                          )}
                          {registration.registration_end_at && (
                            <div>
                              <span className="font-medium">Ends:</span> <ClientTimestamp timestamp={registration.registration_end_at} />
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-500">Always available</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Created</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {new Date(registration.created_at).toLocaleDateString()}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Registration Categories - now with drag-and-drop */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white shadow rounded-lg">
                <div className="px-6 py-4 border-b border-gray-200">
                  <div className="flex justify-between items-center">
                    <h2 className="text-lg font-medium text-gray-900">Registration Categories</h2>
                    <Link
                      href={`/admin/registrations/${id}/categories/new`}
                      className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      Add Category
                    </Link>
                  </div>
                </div>
                {!categories || categories.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-gray-500 text-lg mb-4">No categories created yet</div>
                    <p className="text-sm text-gray-600 mb-4">
                      Categories help organize different types of participants (e.g., Players, Goalies, Alternates)
                    </p>
                    <Link
                      href={`/admin/registrations/${id}/categories/new`}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                    >
                      Add First Category
                    </Link>
                  </div>
                ) : (
                  <div className="p-4">
                    {/* Drag-and-drop list for registration categories */}
                    <RegistrationCategoriesDndList categories={categories} registrationId={id} />
                  </div>
                )}
              </div>

              {/* Games Section - Only show if alternates are enabled */}
              {registration.allow_alternates && (
                <div className="bg-white shadow rounded-lg">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <div className="flex justify-between items-center">
                      <h2 className="text-lg font-medium text-gray-900">Games</h2>
                      <Link
                        href={`/admin/registrations/${id}/games`}
                        className="inline-flex items-center px-3 py-1 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        Manage All Games
                      </Link>
                    </div>
                  </div>
                  <div className="p-6">
                    <GamesPreview registrationId={id} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Navigation */}
          <div className="mt-6">
            <Link
              href="/admin/registrations"
              className="text-blue-600 hover:text-blue-500 text-sm font-medium"
            >
              ← Back to Registrations
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}