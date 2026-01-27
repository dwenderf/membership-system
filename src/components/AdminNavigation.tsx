'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
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

interface AdminNavigationProps {
  user: User | null
}

export default function AdminNavigation({ user }: AdminNavigationProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const pathname = usePathname()

  // Delay closing dropdown to prevent flickering when moving between menu and dropdown
  const handleDropdownClose = (itemName: string) => {
    setTimeout(() => {
      setOpenDropdown(current => current === itemName ? null : current)
    }, 100)
  }

  const navigation = [
    { 
      name: 'Dashboard', 
      href: '/admin', 
      current: pathname === '/admin' 
    },
    { 
      name: 'Management', 
      href: '/admin/seasons', 
      current: pathname.startsWith('/admin/seasons') || 
               pathname.startsWith('/admin/memberships') || 
               pathname.startsWith('/admin/registrations') ||
               pathname.startsWith('/admin/alternates'),
      submenu: [
        { name: 'Seasons', href: '/admin/seasons' },
        { name: 'Memberships', href: '/admin/memberships' },
        { name: 'Registrations', href: '/admin/registrations' },
        { name: 'Alternates', href: '/admin/alternates' }
      ]
    },
    {
      name: 'Configuration',
      href: '/admin/discount-categories',
      current: pathname.startsWith('/admin/discount-categories') ||
               pathname.startsWith('/admin/accounting-codes') ||
               pathname.startsWith('/admin/accounting') ||
               pathname.startsWith('/admin/registration-categories') ||
               pathname.startsWith('/admin/logs') ||
               pathname.startsWith('/admin/security'),
      submenu: [
        { name: 'Registration Categories', href: '/admin/registration-categories' },
        { name: 'Discount Categories', href: '/admin/discount-categories' },
        { name: 'Accounting Codes', href: '/admin/accounting-codes' },
        { name: 'Accounting Integration', href: '/admin/accounting' },
        { name: 'Logs', href: '/admin/logs' },
        { name: 'Security Logs', href: '/admin/security' }
      ]
    },
    {
      name: 'Reports',
      href: '/admin/reports/financial',
      current: pathname.startsWith('/admin/reports'),
      submenu: [
        { name: 'Financial Reports', href: '/admin/reports/financial' },
        { name: 'Membership Reports', href: '/admin/reports/memberships' },
        { name: 'Registration Reports', href: '/admin/reports/registrations' },
        { name: 'Discount Usage', href: '/admin/reports/discount-usage' },
        { name: 'Payment Plans', href: '/admin/reports/payment-plans' },
        { name: 'User Reports', href: '/admin/reports/users' }
      ]
    }
  ]

  return (
    <nav className="bg-white shadow-sm border-b sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link href="/admin" className="flex items-center space-x-2">
                {/* Mobile/tablet: text wordmark with logo */}
                <span
                  className="lg:hidden flex items-center text-gray-900"
                  style={{ fontFamily: "'Karben 105 Stencil', Impact, 'Arial Black', sans-serif" }}
                >
                  <span className="text-base font-bold tracking-tight">NYC</span>
                  <img
                    src="/images/logo.png"
                    alt=""
                    className="h-10 w-auto mx-1"
                  />
                  <span className="text-base font-bold tracking-tight">PRIDE HOCKEY ALLIANCE</span>
                </span>
                {/* Desktop: square logo */}
                <img
                  src="/images/logo.png"
                  alt={`${getOrganizationName('short')} logo`}
                  className="h-12 w-auto hidden lg:block"
                />
                <span className="text-xl font-bold text-gray-900 hidden lg:inline">Admin</span>
              </Link>
            </div>
            <div className="hidden lg:ml-6 lg:flex lg:space-x-8">
              {navigation.map((item) => (
                <div 
                  key={item.name} 
                  className="relative"
                  onMouseEnter={() => item.submenu && setOpenDropdown(item.name)}
                  onMouseLeave={() => item.submenu && handleDropdownClose(item.name)}
                >
                  <Link
                    href={item.href}
                    className={`${
                      item.current
                        ? 'border-blue-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium h-16`}
                  >
                    {item.name}
                  </Link>
                  
                  {item.submenu && openDropdown === item.name && (
                    <div 
                      className="absolute left-0 mt-0 w-48 bg-white shadow-lg border border-gray-200 rounded-md z-50"
                      onMouseEnter={() => setOpenDropdown(item.name)}
                      onMouseLeave={() => handleDropdownClose(item.name)}
                    >
                      <div className="py-1">
                        {item.submenu.map((subItem) => {
                          const isActive = pathname.startsWith(subItem.href)
                          const isHovered = hoveredItem === `${item.name}-${subItem.name}`
                          
                          return (
                            <Link
                              key={subItem.name}
                              href={subItem.href}
                              className={`block px-4 py-2 text-sm transition-colors duration-150 ${
                                isActive
                                  ? 'bg-blue-50 text-blue-700'
                                  : isHovered
                                  ? 'bg-gray-100 text-gray-900'
                                  : 'text-gray-700'
                              }`}
                              onMouseEnter={() => setHoveredItem(`${item.name}-${subItem.name}`)}
                              onMouseLeave={() => setHoveredItem(null)}
                              onClick={() => {
                                setOpenDropdown(null)
                                setHoveredItem(null)
                              }}
                            >
                              {subItem.name}
                            </Link>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          
          <div className="hidden lg:ml-6 lg:flex lg:items-center space-x-4">
            <div className="flex items-center space-x-3">
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
            </div>
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
          <div className="lg:hidden flex items-center">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
            >
              <span className="sr-only">Open admin menu</span>
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
        <div className="lg:hidden">
          <div className="pt-2 pb-3 space-y-1">
            {navigation.map((item) => (
              <div key={item.name}>
                <Link
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
                {item.submenu && (
                  <div className="ml-4 space-y-1">
                    {item.submenu.map((subItem) => (
                      <Link
                        key={subItem.name}
                        href={subItem.href}
                        className={`${
                          pathname.startsWith(subItem.href)
                            ? 'bg-blue-50 border-blue-500 text-blue-700'
                            : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
                        } block pl-6 pr-4 py-1 border-l-4 text-sm`}
                        onClick={() => setIsMenuOpen(false)}
                      >
                        {subItem.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
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
              <div className="px-4 py-2">
                <p className="text-sm font-medium text-gray-900 mb-2">Switch View:</p>
                <div className="flex space-x-2">
                  <span className="flex-1 bg-blue-600 text-white px-3 py-2 rounded text-center text-sm font-medium">
                    Admin
                  </span>
                  <Link
                    href="/user"
                    className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-2 rounded text-center text-sm font-medium"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Member
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}