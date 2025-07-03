'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface CategoryFilterProps {
  categories: { id: string; name: string }[]
  selectedCategory?: string
}

export default function CategoryFilter({ categories, selectedCategory }: CategoryFilterProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleCategoryChange = (categoryId: string) => {
    const params = new URLSearchParams(searchParams)
    if (categoryId) {
      params.set('category', categoryId)
    } else {
      params.delete('category')
    }
    router.push(`/admin/discount-codes?${params.toString()}`)
  }

  return (
    <div className="flex items-center space-x-2">
      <label htmlFor="category-filter" className="text-sm font-medium text-gray-700">
        Filter by category:
      </label>
      <select
        id="category-filter"
        value={selectedCategory || ''}
        onChange={(e) => handleCategoryChange(e.target.value)}
        className="block w-48 border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
      >
        <option value="">All Categories</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </div>
  )
}