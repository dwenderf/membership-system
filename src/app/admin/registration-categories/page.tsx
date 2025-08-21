// No longer a client component
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SystemCategoriesDndList, { Category } from '@/components/SystemCategoriesDndList'

export default async function RegistrationCategoriesPage() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (userError || !userData?.is_admin) {
    redirect('/user')
  }
  const { data: categories, error } = await supabase
    .from('categories')
    .select('*')
    .order('sort_order')
    .order('name')
  if (error) {
    console.error('Error fetching categories:', error)
  }
  const systemCategories: Category[] = categories?.filter((cat: Category) => cat.category_type === 'system') || []
  const userCategories: Category[] = categories?.filter((cat: Category) => cat.category_type === 'user') || []

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Registration Categories</h1>
              <p className="mt-1 text-sm text-gray-600">
                Manage master category templates used across registrations
              </p>
            </div>
            <Link
              href="/admin/registration-categories/new"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Create New Category
            </Link>
          </div>
          <div className="space-y-8">
            {/* System Categories Section */}
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                  System Categories
                </h3>
                <p className="text-sm text-gray-500 mb-6">
                  Built-in categories that are available across all registration types.
                </p>
                {systemCategories.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-gray-500">No system categories found.</p>
                  </div>
                ) : (
                  <SystemCategoriesDndList categories={systemCategories} />
                )}
              </div>
            </div>
            {/* User Categories Section (table remains unchanged) */}
            {/* ...existing code for userCategories... */}
          </div>
        </div>
      </div>
    </div>
  )
}