'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useParams } from 'next/navigation'
import AdminHeader from '@/components/AdminHeader'

interface Category {
  id: string
  name: string
  description: string | null
  category_type: string
  created_at: string
}

export default function EditRegistrationCategoryPage() {
  const router = useRouter()
  const params = useParams()
  const categoryId = params.id as string

  const [category, setCategory] = useState<Category | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)

  useEffect(() => {
    const fetchCategory = async () => {
      try {
        const response = await fetch(`/api/admin/registration-categories/${categoryId}`)
        if (!response.ok) {
          const data = await response.json()
          setError(data.error || 'Failed to fetch category')
          return
        }

        const data = await response.json()
        setCategory(data)
        setName(data.name)
        setDescription(data.description || '')
      } catch (err) {
        setError('An unexpected error occurred')
        console.error('Error fetching category:', err)
      } finally {
        setInitialLoading(false)
      }
    }

    fetchCategory()
  }, [categoryId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch(`/api/admin/registration-categories/${categoryId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to update category')
        return
      }

      router.push('/admin/registration-categories')
    } catch (err) {
      setError('An unexpected error occurred')
      console.error('Error updating category:', err)
    } finally {
      setLoading(false)
    }
  }

  if (initialLoading) {
    return (
      <>
        <AdminHeader
          title="Edit Registration Category"
          description="Loading..."
          backLink="/admin/registration-categories"
        />
        <div className="bg-white shadow rounded-lg p-6">
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/4 mb-6"></div>
            <div className="h-10 bg-gray-200 rounded mb-4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/3 mb-6"></div>
            <div className="h-24 bg-gray-200 rounded mb-4"></div>
          </div>
        </div>
      </>
    )
  }

  if (!category) {
    return (
      <>
        <AdminHeader
          title="Edit Registration Category"
          description="Category not found"
          backLink="/admin/registration-categories"
        />
        <div className="bg-white shadow rounded-lg p-6">
          <div className="text-center py-8">
            <p className="text-gray-500">Category not found or you don't have permission to edit it.</p>
            <Link
              href="/admin/registration-categories"
              className="mt-4 inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
              Back to Categories
            </Link>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <AdminHeader
        title="Edit Registration Category"
        description={`Update the ${category.name} category template`}
        backLink="/admin/registration-categories"
      />

      <div className="bg-white shadow rounded-lg">
        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
              Category Name *
            </label>
            <div className="mt-1">
              <input
                type="text"
                name="name"
                id="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="e.g. Player, Goalie, Coach"
                maxLength={100}
              />
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Choose a clear, descriptive name that will be recognizable across different registration types.
            </p>
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700">
              Description
            </label>
            <div className="mt-1">
              <textarea
                name="description"
                id="description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="Optional description to explain when this category should be used..."
                maxLength={500}
              />
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Provide additional context about when and how this category should be used.
            </p>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-gray-800">
                  Category Information
                </h3>
                <div className="mt-2 text-sm text-gray-600 space-y-1">
                  <p><strong>Type:</strong> {category.category_type === 'system' ? 'System Category' : 'Custom Category'}</p>
                  <p><strong>Created:</strong> {new Date(category.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
            <Link
              href="/admin/registration-categories"
              className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Updating...' : 'Update Category'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}