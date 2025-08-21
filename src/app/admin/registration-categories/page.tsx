"use client"
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import React, { useState } from 'react'
import {
  DndContext,
  closestCenter
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

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
  const systemCategories = categories?.filter(cat => cat.category_type === 'system') || []
  const userCategories = categories?.filter(cat => cat.category_type === 'user') || []

  // --- DND-KIT IMPLEMENTATION ---
  // This is a React Client Component region
  // You may want to move this logic to a separate file/component for maintainability
  // For demo purposes, here's the main logic:

  // ...existing code...

  // System Categories Drag-and-Drop List
  interface Category {
    id: string
    name: string
    description?: string
    created_at: string
    sort_order?: number
    [key: string]: any
  }

  interface SystemCategoriesDndListProps {
    categories: Category[]
  }

  function SystemCategoriesDndList({ categories }: SystemCategoriesDndListProps) {
    const [items, setItems] = useState<string[]>(categories.map((cat: Category) => cat.id))
    const [catMap, setCatMap] = useState<Record<string, Category>>(() => {
      const map: Record<string, Category> = {}
      categories.forEach((cat: Category) => { map[cat.id] = cat })
      return map
    })

    // Update local state when categories change
    React.useEffect(() => {
      setItems(categories.map((cat: Category) => cat.id))
      setCatMap(() => {
        const map: Record<string, Category> = {}
        categories.forEach((cat: Category) => { map[cat.id] = cat })
        return map
      })
    }, [categories])

    // Handle drag end
  const handleDragEnd = async (event: any) => {
      const { active, over } = event
      if (active.id !== over?.id) {
        const oldIndex = items.indexOf(active.id)
        const newIndex = items.indexOf(over.id)
        const newItems = arrayMove(items, oldIndex, newIndex)
        setItems(newItems)

        // Update sort_order for each category
        for (let i = 0; i < newItems.length; i++) {
          const catId = newItems[i]
          // Call your API to update sort_order
          fetch(`/api/admin/registration-categories/${catId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sort_order: i })
          })
        }
      }
    }

    // Sortable item component
    function SortableItem({ id }: { id: string }) {
      const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
      const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        background: isDragging ? '#e0e7ff' : 'white',
        boxShadow: isDragging ? '0 2px 8px rgba(0,0,0,0.15)' : undefined
      }
      const cat = catMap[id]
      return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="flex items-center border-b py-3 px-2 cursor-grab">
          <span className="mr-3 text-gray-400 text-xl">&#9776;</span>
          <div className="flex-1">
            <div className="font-medium text-gray-900">{cat.name}</div>
            <div className="text-sm text-gray-500">{cat.description || 'No description'}</div>
            <div className="text-xs text-gray-400">Created: {new Date(cat.created_at).toLocaleDateString()}</div>
          </div>
          <Link href={`/admin/registration-categories/${cat.id}/edit`} className="ml-4 text-blue-600 hover:text-blue-900 text-sm font-medium">Edit</Link>
        </div>
      )
    }

    return (
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          <div className="divide-y divide-gray-200 rounded-lg overflow-hidden bg-white">
            {items.map(id => (
              <SortableItem key={id} id={id} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    )
  }

  // ...existing code...

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

            {/* User Categories Section */}
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                  Custom Categories
                </h3>
                <p className="text-sm text-gray-500 mb-6">
                  Categories created by administrators for specific use cases.
                </p>
                
                {userCategories.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-gray-500">No custom categories found.</p>
                    <p className="text-sm text-gray-400 mt-2">
                      Create a new category to get started.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Name
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Description
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Created
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {userCategories.map((category) => (
                          <tr key={category.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900">
                                {category.name}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="text-sm text-gray-500 max-w-xs truncate">
                                {category.description || 'No description'}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {new Date(category.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <Link
                                href={`/admin/registration-categories/${category.id}/edit`}
                                className="text-blue-600 hover:text-blue-900"
                              >
                                Edit
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}