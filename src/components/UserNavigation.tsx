'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import AdminToggle from './AdminToggle'
import { getOrganizationName } from '@/lib/organization'

interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  is_admin: boolean
  member_id?: number
  tags?: string[]
}

interface UserNavigationProps {
  user: User | null
  useToggle?: boolean
}

export default function UserNavigation({ user, useToggle = false }: UserNavigationProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const pathname = usePathname()

  const navigation = [
    { name: 'Dashboard', href: '/user', current: pathname === '/user' },
    { name: 'My Memberships', href: '/user/memberships', current: pathname === '/user/memberships' },
    { name: 'My Registrations', href: '/user/registrations', current: pathname === '/user/registrations' },
  ]

  return (
    <nav className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link href="/user" className="text-xl font-bold text-gray-900">
                {getOrganizationName('short')}
              </Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`${
                    item.current
                      ? 'border-blue-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>
          
          <div className="hidden sm:ml-6 sm:flex sm:items-center space-x-4">
            {user?.is_admin && (
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-1 bg-gray-100 rounded-md p-1">
                  <Link
                    href="/admin"
                    className="px-3 py-1 rounded text-sm font-medium text-gray-600 hover:bg-white hover:text-gray-800"
                  >
                    Admin
                  </Link>
                  <span className="px-3 py-1 rounded text-sm font-medium bg-blue-600 text-white">
                    Member
                  </span>
                </div>
              </div>
            )}
            <div className="flex items-center">
              <Link 
                href="/user/account"
                className="text-sm text-gray-700 hover:text-gray-900 font-medium flex items-center space-x-2"
              >
                <span>{user?.first_name} {user?.last_name}</span>
                {user?.member_id && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                    #{user.member_id}
                  </span>
                )}
              </Link>
            </div>
          </div>

          {/* Mobile menu button */}
          <div className="sm:hidden flex items-center">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
            >
              <span className="sr-only">Open main menu</span>
              {!isMenuOpen ? (
                <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              ) : (
                <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {isMenuOpen && (
        <div className="sm:hidden">
          <div className="pt-2 pb-3 space-y-1">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className={`${
                  item.current
                    ? 'bg-blue-50 border-blue-500 text-blue-700'
                    : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
                } block pl-3 pr-4 py-2 border-l-4 text-base font-medium`}
                onClick={() => setIsMenuOpen(false)}
              >
                {item.name}
              </Link>
            ))}
          </div>
          <div className="pt-4 pb-3 border-t border-gray-200">
            <div className="flex items-center px-4">
              <div className="flex-shrink-0">
                <Link 
                  href="/user/account"
                  className="text-sm font-medium text-gray-900 hover:text-gray-600 flex items-center space-x-2"
                  onClick={() => setIsMenuOpen(false)}
                >
                  <span>{user?.first_name} {user?.last_name}</span>
                  {user?.member_id && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                      #{user.member_id}
                    </span>
                  )}
                  <span className="text-xs text-gray-500">(Account Settings)</span>
                </Link>
              </div>
            </div>
            <div className="mt-3 space-y-1">
              {user?.is_admin && (
                <div className="px-4 py-2">
                  <p className="text-sm font-medium text-gray-900 mb-2">Switch View:</p>
                  <div className="flex space-x-2">
                    <Link
                      href="/admin"
                      className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-2 rounded text-center text-sm font-medium"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      Admin
                    </Link>
                    <span className="flex-1 bg-blue-600 text-white px-3 py-2 rounded text-center text-sm font-medium">
                      Member
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}