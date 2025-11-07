'use client'

import Link from 'next/link'
import AdminToggle from './AdminToggle'

interface AdminHeaderProps {
  title: string
  description?: string
  useToggle?: boolean
  backLink?: string
}

export default function AdminHeader({ title, description, useToggle = false, backLink }: AdminHeaderProps) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        <div>
          {backLink && (
            <Link href={backLink} className="text-sm text-blue-600 hover:text-blue-800 mb-2 inline-flex items-center">
              ← Back
            </Link>
          )}
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-gray-600">{description}</p>
          )}
        </div>
        <div className="flex items-center">
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
        </div>
      </div>
    </div>
  )
}