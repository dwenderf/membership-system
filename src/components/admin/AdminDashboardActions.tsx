'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'

interface QuickAction {
  id: string
  label: string
  description: string
  href: string
  group: 'Management' | 'Configuration' | 'Reports'
}

const QUICK_ACTIONS: QuickAction[] = [
  // Management
  { id: 'manage-seasons', label: 'Manage Seasons', description: 'Create and manage hockey seasons', href: '/admin/seasons', group: 'Management' },
  { id: 'manage-memberships', label: 'Manage Memberships', description: 'Set up membership plans and pricing', href: '/admin/memberships', group: 'Management' },
  { id: 'manage-registrations', label: 'Manage Registrations', description: 'Create teams and events', href: '/admin/registrations', group: 'Management' },
  { id: 'manage-alternates', label: 'Manage Alternates', description: 'Select alternates across all registrations', href: '/admin/alternates', group: 'Management' },
  // Configuration
  { id: 'configure-registration-categories', label: 'Configure Registration Categories', description: 'Manage master category templates', href: '/admin/registration-categories', group: 'Configuration' },
  { id: 'configure-discount-categories', label: 'Configure Discount Categories', description: 'Manage categories and discount codes', href: '/admin/discount-categories', group: 'Configuration' },
  { id: 'configure-accounting-codes', label: 'Configure Accounting Codes', description: 'Configure default codes and bulk updates', href: '/admin/accounting-codes', group: 'Configuration' },
  { id: 'configure-accounting-integration', label: 'Configure Accounting Integration', description: 'Connect and manage Xero accounting', href: '/admin/accounting', group: 'Configuration' },
  { id: 'view-logs', label: 'View Logs', description: 'Monitor application logs and system events', href: '/admin/logs', group: 'Configuration' },
  { id: 'view-security-logs', label: 'View Security Logs', description: 'Review security audit logs', href: '/admin/security', group: 'Configuration' },
  // Reports
  { id: 'financial-reports', label: 'Financial Reports', description: 'View financial summaries and transactions', href: '/admin/reports/financial', group: 'Reports' },
  { id: 'membership-reports', label: 'Membership Reports', description: 'Analyze membership trends and data', href: '/admin/reports/memberships', group: 'Reports' },
  { id: 'registration-reports', label: 'Registration Reports', description: 'View registration statistics', href: '/admin/reports/registrations', group: 'Reports' },
  { id: 'discount-usage', label: 'Discount Usage', description: 'Track discount code usage', href: '/admin/reports/discount-usage', group: 'Reports' },
  { id: 'payment-plans', label: 'Payment Plans', description: 'Review active payment plans', href: '/admin/reports/payment-plans', group: 'Reports' },
  { id: 'user-reports', label: 'User Reports', description: 'View and manage user accounts and permissions', href: '/admin/reports/users', group: 'Reports' },
]

const GROUPS: QuickAction['group'][] = ['Management', 'Configuration', 'Reports']

interface AdminDashboardActionsProps {
  initialFavorites: string[]
}

function DragHandleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="5" cy="4" r="1.2" />
      <circle cx="5" cy="8" r="1.2" />
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="10" cy="4" r="1.2" />
      <circle cx="10" cy="8" r="1.2" />
      <circle cx="10" cy="12" r="1.2" />
    </svg>
  )
}

function StarIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  ) : (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  )
}

function SortableFavoriteItem({
  action,
  onToggle,
}: {
  action: QuickAction
  onToggle: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: action.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 bg-white border rounded-lg p-3 ${isDragging ? 'opacity-50 shadow-lg border-blue-300' : 'border-gray-200'}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
        aria-label="Drag to reorder"
      >
        <DragHandleIcon />
      </button>
      <Link href={action.href} className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 hover:text-blue-600 truncate">{action.label}</div>
        <div className="text-xs text-gray-500 truncate">{action.description}</div>
      </Link>
      <button
        onClick={() => onToggle(action.id)}
        className="text-yellow-400 hover:text-yellow-500 flex-shrink-0"
        aria-label="Remove from favorites"
      >
        <StarIcon filled={true} />
      </button>
    </div>
  )
}

export default function AdminDashboardActions({ initialFavorites }: AdminDashboardActionsProps) {
  const [favorites, setFavorites] = useState<string[]>(initialFavorites)

  const savePreferences = useCallback(async (newFavorites: string[]) => {
    try {
      await fetch('/api/user/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminFavorites: newFavorites }),
      })
    } catch (err) {
      console.error('Failed to save preferences:', err)
    }
  }, [])

  const toggleFavorite = (id: string) => {
    const newFavorites = favorites.includes(id)
      ? favorites.filter(f => f !== id)
      : [...favorites, id]
    setFavorites(newFavorites)
    savePreferences(newFavorites)
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = favorites.indexOf(active.id as string)
      const newIndex = favorites.indexOf(over.id as string)
      const newFavorites = arrayMove(favorites, oldIndex, newIndex)
      setFavorites(newFavorites)
      savePreferences(newFavorites)
    }
  }

  const favoritedActions = favorites
    .map(id => QUICK_ACTIONS.find(a => a.id === id))
    .filter((a): a is QuickAction => a !== undefined)

  return (
    <>
      {/* Favorites */}
      <div className="bg-white shadow rounded-lg mb-8">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900 mb-1">Favorites</h3>
          <p className="text-sm text-gray-500 mb-4">
            {favoritedActions.length === 0
              ? 'No favorites yet — star an action below to add it here.'
              : 'Drag to reorder. Click a star to remove.'}
          </p>

          {favoritedActions.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            >
              <SortableContext items={favorites} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {favoritedActions.map(action => (
                    <SortableFavoriteItem key={action.id} action={action} onToggle={toggleFavorite} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Quick Actions</h3>
          <div className="space-y-6">
            {GROUPS.map(group => (
              <div key={group}>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{group}</h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {QUICK_ACTIONS.filter(a => a.group === group).map(action => {
                    const isFavorited = favorites.includes(action.id)
                    return (
                      <div
                        key={action.id}
                        className="relative block w-full border-2 border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
                      >
                        <button
                          onClick={() => toggleFavorite(action.id)}
                          className={`absolute top-3 right-3 ${isFavorited ? 'text-yellow-400 hover:text-yellow-500' : 'text-gray-300 hover:text-yellow-400'}`}
                          aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <StarIcon filled={isFavorited} />
                        </button>
                        <Link href={action.href} className="block pr-6">
                          <div className="text-gray-900 font-medium text-sm">{action.label}</div>
                          <div className="mt-1 text-xs text-gray-500">{action.description}</div>
                        </Link>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
