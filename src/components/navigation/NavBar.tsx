'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getOrganizationName } from '@/lib/organization'

export interface NavSubItem {
  name: string
  href: string
}

export interface NavItem {
  name: string
  href: string
  current: boolean
  badge?: string
  submenu?: NavSubItem[]
}

interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  is_admin: boolean
  member_id?: number
  tags?: string[]
}

interface NavBarProps {
  navigation: NavItem[]
  user: User | null
  isAdminView: boolean
  homeHref: string
}

const pillActive = 'px-3 py-1 rounded text-sm font-medium bg-brand-ink text-white'
const pillInactive = 'px-3 py-1 rounded text-sm font-medium text-gray-600 hover:bg-white hover:text-gray-800'
const mobilePillActive = 'flex-1 bg-brand-ink text-white px-3 py-2 rounded text-center text-sm font-medium'
const mobilePillInactive = 'flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-2 rounded text-center text-sm font-medium'

export default function NavBar({ navigation, user, isAdminView, homeHref }: NavBarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [openAccordion, setOpenAccordion] = useState<string | null>(null)
  const pathname = usePathname()
  const navRef = useRef<HTMLElement>(null)

  // Close the desktop dropdown on an outside click or Escape (replaces the old
  // hover + setTimeout pattern, which never worked on touch devices).
  useEffect(() => {
    if (!openDropdown) return

    function handleClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenDropdown(null)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenDropdown(null)
    }

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [openDropdown])

  return (
    <nav ref={navRef} className="bg-white shadow-sm border-b sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link href={homeHref} className="flex items-center gap-2 flex-shrink-0">
              <Image
                src="/images/logo.png"
                alt={`${getOrganizationName('short')} logo`}
                width={40}
                height={38}
                className="h-10 w-auto"
              />
              <span className="flex items-center gap-1 font-heading font-extrabold text-base sm:text-lg tracking-tight text-brand-ink">
                <span>My</span>
                <span className="bg-brand-tide px-1.5 rounded">NYCPHA</span>
              </span>
            </Link>

            <div className="hidden xl:ml-6 xl:flex xl:space-x-6">
              {navigation.map((item) => (
                <div key={item.name} className="relative flex items-center">
                  {item.submenu ? (
                    <button
                      type="button"
                      aria-haspopup="true"
                      aria-expanded={openDropdown === item.name}
                      onClick={() => setOpenDropdown(openDropdown === item.name ? null : item.name)}
                      className={`${
                        item.current
                          ? 'border-brand-tide text-brand-ink'
                          : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      } inline-flex items-center gap-1 px-1 pt-1 border-b-2 text-sm font-medium h-16`}
                    >
                      {item.name}
                      <svg
                        className={`w-4 h-4 transition-transform ${openDropdown === item.name ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  ) : (
                    <Link
                      href={item.href}
                      className={`${
                        item.current
                          ? 'border-brand-tide text-brand-ink'
                          : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium h-16`}
                    >
                      {item.name}
                      {item.badge && (
                        <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  )}

                  {item.submenu && openDropdown === item.name && (
                    <div className="absolute left-0 top-full w-56 bg-white shadow-lg border border-gray-200 rounded-md z-50">
                      <div className="py-1">
                        {item.submenu.map((subItem) => {
                          const isActive = pathname.startsWith(subItem.href)
                          return (
                            <Link
                              key={subItem.name}
                              href={subItem.href}
                              className={`block px-4 py-2 text-sm ${
                                isActive ? 'bg-brand-tide/10 text-brand-ink' : 'text-gray-700 hover:bg-gray-100'
                              }`}
                              onClick={() => setOpenDropdown(null)}
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

          <div className="hidden xl:flex xl:items-center space-x-4">
            {user?.is_admin && (
              <div className="flex items-center space-x-1 bg-gray-100 rounded-md p-1">
                {isAdminView ? (
                  <span className={pillActive}>Admin</span>
                ) : (
                  <Link href="/admin" className={pillInactive}>Admin</Link>
                )}
                {isAdminView ? (
                  <Link href="/user" className={pillInactive}>Member</Link>
                ) : (
                  <span className={pillActive}>Member</span>
                )}
              </div>
            )}
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

          <div className="xl:hidden flex items-center">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
            >
              <span className="sr-only">{isMenuOpen ? 'Close main menu' : 'Open main menu'}</span>
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

      {/* Mobile menu — a scrollable full-panel overlay below the fixed top bar,
          so a long list (e.g. admin's grouped items) scrolls instead of overflowing. */}
      {isMenuOpen && (
        <div className="xl:hidden fixed inset-x-0 top-16 bottom-0 z-40 bg-white overflow-y-auto border-t border-gray-200">
          <div className="pt-2 pb-3 space-y-1">
            {navigation.map((item) => (
              <div key={item.name}>
                {item.submenu ? (
                  <button
                    type="button"
                    aria-expanded={openAccordion === item.name}
                    onClick={() => setOpenAccordion(openAccordion === item.name ? null : item.name)}
                    className={`${
                      item.current ? 'text-brand-ink font-semibold' : 'text-gray-600'
                    } w-full pl-3 pr-2 py-2 text-base font-medium flex items-center justify-between`}
                  >
                    <span>{item.name}</span>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${openAccordion === item.name ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                ) : (
                  <Link
                    href={item.href}
                    className={`${
                      item.current ? 'text-brand-ink font-semibold' : 'text-gray-600'
                    } pl-3 pr-2 py-2 text-base font-medium flex items-center justify-between`}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    <span>{item.name}</span>
                    {item.badge && (
                      <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                )}
                {item.submenu && openAccordion === item.name && (
                  <div className="mx-3 mb-2 rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                    {item.submenu.map((subItem) => {
                      const isActive = pathname.startsWith(subItem.href)
                      return (
                        <Link
                          key={subItem.name}
                          href={subItem.href}
                          className={`block px-4 py-2 text-sm ${
                            isActive ? 'bg-brand-tide/10 text-brand-ink font-medium' : 'text-gray-600'
                          }`}
                          onClick={() => setIsMenuOpen(false)}
                        >
                          {subItem.name}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="pt-4 pb-6 border-t border-gray-200">
            <div className="flex items-center px-4">
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
            {user?.is_admin && (
              <div className="px-4 py-2 mt-2">
                <p className="text-sm font-medium text-gray-900 mb-2">Switch View:</p>
                <div className="flex space-x-2">
                  {isAdminView ? (
                    <span className={mobilePillActive}>Admin</span>
                  ) : (
                    <Link href="/admin" className={mobilePillInactive} onClick={() => setIsMenuOpen(false)}>
                      Admin
                    </Link>
                  )}
                  {isAdminView ? (
                    <Link href="/user" className={mobilePillInactive} onClick={() => setIsMenuOpen(false)}>
                      Member
                    </Link>
                  ) : (
                    <span className={mobilePillActive}>Member</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
