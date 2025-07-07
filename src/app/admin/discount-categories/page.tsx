import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function DiscountCategoriesPage() {
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

  // Get all discount categories with code counts
  const { data: categories, error } = await supabase
    .from('discount_categories')
    .select(`
      *,
      discount_codes (count)
    `)
    .order('name', { ascending: true })

  if (error) {
    console.error('Error fetching discount categories:', error)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Discount Categories</h1>
              <p className="mt-1 text-sm text-gray-600">
                Manage organizational discount categories with accounting codes and spending limits
              </p>
            </div>
            <Link
              href="/admin/discount-categories/new"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Create New Category
            </Link>
          </div>

          {/* Categories List */}
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            {!categories || categories.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-gray-500 text-lg mb-4">No discount categories created yet</div>
                <Link
                  href="/admin/discount-categories/new"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                >
                  Create Your First Category
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {categories.map((category: any) => {
                  const codeCount = category.discount_codes?.[0]?.count || 0
                  
                  return (
                    <li key={category.id}>
                      <div className="px-4 py-4 flex items-center justify-between">
                        <div className="flex items-center flex-1">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center">
                              <p className="text-lg font-medium text-gray-900 truncate">
                                {category.name}
                              </p>
                              <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                                {codeCount} code{codeCount !== 1 ? 's' : ''}
                              </span>
                              {!category.is_active && (
                                <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                  Inactive
                                </span>
                              )}
                            </div>
                            {category.description && (
                              <p className="mt-1 text-sm text-gray-600 truncate">
                                {category.description}
                              </p>
                            )}
                            <div className="mt-1 flex items-center text-sm text-gray-500">
                              <span>Accounting Code: {category.accounting_code}</span>
                              {category.max_discount_per_user_per_season && (
                                <>
                                  <span className="mx-2">•</span>
                                  <span>Limit: ${(category.max_discount_per_user_per_season / 100).toFixed(2)}/season</span>
                                </>
                              )}
                              {!category.max_discount_per_user_per_season && (
                                <>
                                  <span className="mx-2">•</span>
                                  <span className="text-green-600">No Limit</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-4">
                          <Link
                            href={`/admin/discount-categories/${category.id}/edit`}
                            className="text-blue-600 hover:text-blue-500 text-sm font-medium"
                          >
                            Edit
                          </Link>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Navigation Links */}
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