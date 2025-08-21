"use client"

import { useState } from "react"
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import {SortableItem} from "./SortableItem"

export interface RegistrationCategory {
  id: string
  name?: string
  description?: string | null
  sort_order: number
  max_capacity?: number | null
  price?: number | null
  memberships?: { id: string; name: string } | null
  custom_name?: string | null
  category_type?: string
  categories?: {
    name?: string
    description?: string | null
    category_type?: string
  }
}

interface Props {
  categories: RegistrationCategory[]
  registrationId: string
  onReorder?: (newOrder: RegistrationCategory[]) => void
}

export default function RegistrationCategoriesDndList({ categories, registrationId, onReorder }: Props) {
  const [items, setItems] = useState(categories.sort((a, b) => a.sort_order - b.sort_order))
  const sensors = useSensors(
    useSensor(PointerSensor)
  )

  const handleDragEnd = async (event: any) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((item) => item.id === active.id)
    const newIndex = items.findIndex((item) => item.id === over.id)
    const newItems = arrayMove(items, oldIndex, newIndex)
    setItems(newItems)
    // Update sort_order in backend
    await fetch(`/api/admin/registrations/${registrationId}/categories/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order: newItems.map((item, idx) => ({ id: item.id, sort_order: idx }))
      })
    })
    if (onReorder) onReorder(newItems)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="divide-y divide-gray-200">
          {items.map((category) => {
            const isCustom = !!category.custom_name
            const displayName = category.custom_name || (category.categories?.name ?? category.name) || 'Unnamed Category'
            const priceDisplay = category.price !== undefined && category.price !== null ? `$${(category.price / 100).toFixed(2)}` : null
            const capacityDisplay = category.max_capacity ? `${category.max_capacity} spots` : 'Unlimited'
            return (
              <SortableItem key={category.id} id={category.id}>
                <div className="flex items-stretch px-0 py-4 bg-white">
                  {/* Taller grab handle, aligned left */}
                  <div className="flex flex-col justify-center items-center px-4 select-none cursor-grab" style={{ minWidth: '32px' }} title="Drag to reorder">
                    <svg width="20" height="40" fill="none" viewBox="0 0 20 40">
                      <circle cx="10" cy="8" r="2" fill="currentColor" />
                      <circle cx="10" cy="20" r="2" fill="currentColor" />
                      <circle cx="10" cy="32" r="2" fill="currentColor" />
                    </svg>
                  </div>
                  <div className="flex-1 px-2">
                    <div className="flex items-center mb-2">
                      <span className="text-lg font-medium text-gray-900">{displayName}</span>
                      {isCustom && (
                        <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                          Custom
                        </span>
                      )}
                      {!isCustom && (
                        <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          System
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {category.description}
                    </div>
                    <div className="mt-1 text-sm text-gray-500 flex flex-wrap items-center gap-x-4">
                      {priceDisplay && <span className="font-medium text-gray-700">Price: {priceDisplay}</span>}
                      {category.memberships && (
                        <span>Requires: {category.memberships.name}</span>
                      )}
                      {category.max_capacity !== undefined && (
                        <span>Capacity: {capacityDisplay}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center px-4">
                    <a
                      href={`/admin/registrations/${registrationId}/categories/${category.id}/edit`}
                      className="text-blue-600 hover:text-blue-500 text-sm font-medium"
                    >
                      Edit
                    </a>
                  </div>
                </div>
              </SortableItem>
            )
          })}
        </div>
      </SortableContext>
    </DndContext>
  )
}
