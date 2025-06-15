import { createClient } from '@/lib/supabase/server'
import { formatDateString } from '@/lib/date-utils'
import { getCategoryDisplayName, isCategoryCustom } from '@/lib/registration-utils'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'

export default async function RegistrationDetailPage({
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
    .eq('id', params.id)
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
        name,
        price
      )
    `)
    .eq('registration_id', params.id)
    .order('sort_order', { ascending: true })

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
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{registration.name}</h1>
                <p className="mt-1 text-sm text-gray-600">
                  Registration details and category management
                </p>
              </div>
              <div className="flex space-x-3">
                <Link
                  href={`/admin/registrations/${params.id}/categories/new`}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Add Category
                </Link>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Registration Details */}
            <div className="lg:col-span-1">
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">Registration Details</h2>
                <dl className="space-y-4">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Type</dt>
                    <dd className="mt-1 text-sm text-gray-900 capitalize">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        registration.type === 'team' ? 'bg-blue-100 text-blue-800' :
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
                    <dt className="text-sm font-medium text-gray-500">Created</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {new Date(registration.created_at).toLocaleDateString()}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Registration Categories */}
            <div className="lg:col-span-2">
              <div className="bg-white shadow rounded-lg">
                <div className="px-6 py-4 border-b border-gray-200">
                  <div className="flex justify-between items-center">
                    <h2 className="text-lg font-medium text-gray-900">Registration Categories</h2>
                    <span className="text-sm text-gray-500">
                      {categories?.length || 0} categories
                    </span>
                  </div>
                </div>

                {!categories || categories.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-gray-500 text-lg mb-4">No categories created yet</div>
                    <p className="text-sm text-gray-600 mb-4">
                      Categories help organize different types of participants (e.g., Players, Goalies, Alternates)
                    </p>
                    <Link
                      href={`/admin/registrations/${params.id}/categories/new`}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                    >
                      Add First Category
                    </Link>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {categories.map((category) => {
                      // TODO: Calculate current_count from user_registrations when implemented
                      const current_count = 0 // Placeholder until user registrations are implemented
                      const isAtCapacity = category.max_capacity && current_count >= category.max_capacity
                      const capacityPercentage = category.max_capacity 
                        ? (current_count / category.max_capacity) * 100 
                        : 0

                      return (
                        <div key={category.id} className="px-6 py-4">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center">
                                <h3 className="text-lg font-medium text-gray-900">
                                  {getCategoryDisplayName(category)}
                                </h3>
                                {isCategoryCustom(category) && (
                                  <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                                    Custom
                                  </span>
                                )}
                                {isAtCapacity ? (
                                  <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                    Full
                                  </span>
                                ) : (
                                  <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                    Open
                                  </span>
                                )}
                              </div>
                              
                              <div className="mt-1 flex items-center text-sm text-gray-500">
                                <span>
                                  {current_count} registered
                                  {category.max_capacity && ` of ${category.max_capacity} spots`}
                                </span>
                                {category.max_capacity && (
                                  <span className="mx-2">
                                    ({Math.round(capacityPercentage)}% full)
                                  </span>
                                )}
                              </div>

                              {category.memberships && (
                                <div className="mt-1 text-sm text-gray-500">
                                  Requires: {category.memberships.name} (${(category.memberships.price / 100).toFixed(2)})
                                </div>
                              )}

                              {category.max_capacity && (
                                <div className="mt-2">
                                  <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div 
                                      className={`h-2 rounded-full transition-all duration-300 ${
                                        capacityPercentage >= 100 ? 'bg-red-500' :
                                        capacityPercentage >= 80 ? 'bg-yellow-500' :
                                        'bg-green-500'
                                      }`}
                                      style={{ width: `${Math.min(capacityPercentage, 100)}%` }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                            
                            <div className="ml-4 flex items-center space-x-2">
                              <Link
                                href={`/admin/registrations/${params.id}/categories/${category.id}/edit`}
                                className="text-blue-600 hover:text-blue-500 text-sm font-medium"
                              >
                                Edit
                              </Link>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
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