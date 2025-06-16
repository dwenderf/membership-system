'use client'

import Link from 'next/link'

interface AdminToggleProps {
  isAdminView: boolean
}

export default function AdminToggle({ isAdminView }: AdminToggleProps) {
  return (
    <div className="flex items-center space-x-3">
      <span className="text-sm text-gray-700">Admin Mode</span>
      <Link
        href={isAdminView ? "/user" : "/admin"}
        className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
        style={{
          backgroundColor: isAdminView ? '#3B82F6' : '#D1D5DB'
        }}
      >
        <span className="sr-only">Toggle admin mode</span>
        <span
          className={`${
            isAdminView ? 'translate-x-5' : 'translate-x-0'
          } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
        />
      </Link>
    </div>
  )
}