"use client"

import React, { useState, useEffect } from 'react'
import {
  DndContext,
  closestCenter,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Link from 'next/link'

export interface Category {
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

export default function SystemCategoriesDndList({ categories }: SystemCategoriesDndListProps) {
  const [items, setItems] = useState<string[]>(categories.map((cat: Category) => cat.id))
  const [catMap, setCatMap] = useState<Record<string, Category>>(() => {
    const map: Record<string, Category> = {}
    categories.forEach((cat: Category) => { map[cat.id] = cat })
    return map
  })

  useEffect(() => {
    setItems(categories.map((cat: Category) => cat.id))
    setCatMap(() => {
      const map: Record<string, Category> = {}
      categories.forEach((cat: Category) => { map[cat.id] = cat })
      return map
    })
  }, [categories])

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
        fetch(`/api/admin/registration-categories/${catId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sort_order: i })
        })
      }
    }
  }

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
