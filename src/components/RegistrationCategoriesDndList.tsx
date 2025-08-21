"use client"

import { useState } from "react"
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import {SortableItem} from "./SortableItem"

export interface RegistrationCategory {
  id: string
  name: string
  description?: string | null
  sort_order: number
  max_capacity?: number | null
  price?: number | null
  memberships?: { id: string; name: string } | null
  custom_name?: string | null
  category_type?: string
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
          {items.map((category) => (
            <SortableItem key={category.id} id={category.id}>
              <div className="flex items-center justify-between px-6 py-4 bg-white">
                <div>
                  <div className="font-medium text-gray-900">{category.custom_name || category.name}</div>
                  <div className="text-sm text-gray-500">{category.description}</div>
                </div>
                <div className="text-sm text-gray-500">Order: {category.sort_order}</div>
              </div>
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
