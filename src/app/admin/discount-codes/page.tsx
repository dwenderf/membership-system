import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import CategoryFilter from './CategoryFilter'

interface PageProps {
  searchParams: { category?: string }
}

export default async function DiscountCodesPage({ searchParams }: PageProps) {
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

  // Get all discount categories for filter dropdown
  const { data: categories } = await supabase
    .from('discount_categories')
    .select('id, name')
    .order('name')

  // Get discount codes with category info
  let codesQuery = supabase
    .from('discount_codes')
    .select(`
      *,
      discount_categories (
        id,
        name,
        accounting_code,
        max_discount_per_user_per_season
      )
    `)
    .order('percentage', { ascending: false })

  // Filter by category if specified
  if (searchParams.category) {
    codesQuery = codesQuery.eq('discount_category_id', searchParams.category)
  }

  const { data: codes, error } = await codesQuery

  if (error) {
    console.error('Error fetching discount codes:', error)
  }

  // Get selected category name for display
  const selectedCategory = categories?.find(cat => cat.id === searchParams.category)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Discount Codes</h1>
              <p className="mt-1 text-sm text-gray-600">
                Manage discount codes within organizational categories
                {selectedCategory && ` for ${selectedCategory.name}`}
              </p>
            </div>
            <Link
              href={`/admin/discount-codes/new${searchParams.category ? `?category=${searchParams.category}` : ''}`}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Create New Code
            </Link>
          </div>

          {/* Filter and Navigation */}
          <div className="flex items-center justify-between mb-6">
            {!searchParams.category ? (
              <div className="flex items-center space-x-4">
                <CategoryFilter 
                  categories={categories || []} 
                  selectedCategory={searchParams.category}
                />
              </div>
            ) : (
              <div className="flex items-center space-x-4">
                <div className="text-sm text-gray-600">
                  Showing codes for: <span className="font-medium text-gray-900">{selectedCategory?.name}</span>
                </div>
                <Link
                  href="/admin/discount-codes"
                  className="text-blue-600 hover:text-blue-500 text-sm"
                >
                  View all codes
                </Link>
              </div>
            )}
          </div>

          {/* Codes List */}
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            {!codes || codes.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-gray-500 text-lg mb-4">
                  {searchParams.category 
                    ? `No discount codes found for ${selectedCategory?.name || 'this category'}`
                    : 'No discount codes created yet'
                  }
                </div>
                <Link
                  href={`/admin/discount-codes/new${searchParams.category ? `?category=${searchParams.category}` : ''}`}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                >
                  {searchParams.category ? 'Create Code for This Category' : 'Create Your First Code'}
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {codes.map((code: any) => {
                  const isExpired = code.valid_until && new Date(code.valid_until) < new Date()
                  const isNotYetValid = code.valid_from && new Date(code.valid_from) > new Date()
                  
                  return (
                    <li key={code.id}>
                      <div className="px-4 py-4 flex items-center justify-between">
                        <div className="flex items-center flex-1">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center">
                              <p className="text-lg font-medium text-gray-900 font-mono">
                                {code.code}
                              </p>
                              <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                {code.percentage}% off
                              </span>
                              <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                                {code.discount_categories?.name}
                              </span>
                              {!code.is_active && (
                                <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                  Inactive
                                </span>
                              )}
                              {isExpired && (
                                <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                  Expired
                                </span>
                              )}
                              {isNotYetValid && (
                                <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                  Future
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center text-sm text-gray-500">
                              <span>Code: {code.discount_categories?.accounting_code}</span>
                              {code.discount_categories?.max_discount_per_user_per_season && (
                                <>
                                  <span className="mx-2">•</span>
                                  <span>Limit: ${(code.discount_categories.max_discount_per_user_per_season / 100).toFixed(2)}/season</span>
                                </>
                              )}
                              {code.valid_from && (
                                <>
                                  <span className="mx-2">•</span>
                                  <span>Valid from: {new Date(code.valid_from).toLocaleDateString()}</span>
                                </>
                              )}
                              {code.valid_until && (
                                <>
                                  <span className="mx-2">•</span>
                                  <span>Until: {new Date(code.valid_until).toLocaleDateString()}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-4">
                          <Link
                            href={`/admin/discount-codes/${code.id}/edit`}
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
          <div className="mt-6 flex items-center space-x-6">
            <Link
              href="/admin/discount-categories"
              className="text-blue-600 hover:text-blue-500 text-sm font-medium"
            >
              ← Manage Categories
            </Link>
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