'use client'

import Link from 'next/link'
import AdminToggle from './AdminToggle'

interface AdminHeaderProps {
  title: string
  description?: string
  useToggle?: boolean
}

export default function AdminHeader({ title, description, useToggle = false }: AdminHeaderProps) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-gray-600">{description}</p>
          )}
        </div>
        <div className="flex items-center space-x-4">
          {useToggle ? (
            <AdminToggle isAdminView={true} />
          ) : (
            <div className="flex items-center space-x-1 bg-gray-100 rounded-md p-1">
              <span className="px-3 py-1 rounded text-sm font-medium bg-blue-600 text-white">
                Admin
              </span>
              <Link
                href="/user"
                className="px-3 py-1 rounded text-sm font-medium text-gray-600 hover:bg-white hover:text-gray-800"
              >
                Member
              </Link>
            </div>
          )}
          <form action="/auth/signout" method="post" className="inline">
            <button
              type="submit"
              className="text-gray-500 hover:text-gray-700 text-sm font-medium"
            >
              Sign Out
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}