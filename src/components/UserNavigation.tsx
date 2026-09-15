'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { logger } from '@/lib/logging/logger'
import NavBar, { type NavItem } from '@/components/navigation/NavBar'

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

export default function UserNavigation({ user }: UserNavigationProps) {
  const [hasUnpaid, setHasUnpaid] = useState(false)
  const [isCaptain, setIsCaptain] = useState(false)
  const pathname = usePathname()

  // Check for unpaid invoices (only for admins)
  useEffect(() => {
    if (user?.id && user?.is_admin) {
      fetch('/api/xero/unpaid-invoices')
        .then(res => res.json())
        .then(data => setHasUnpaid(data.hasUnpaid))
        .catch(error => {
          logger.logSystem('check-unpaid-invoices-error', 'Error checking unpaid invoices', { userId: user?.id, error: error instanceof Error ? error.message : String(error) }, 'error')
          setHasUnpaid(false)
        })
    }
  }, [user?.id, user?.is_admin])

  // Check if user is a captain of any registration
  useEffect(() => {
    if (user?.id) {
      fetch('/api/user/captain/registrations')
        .then(res => res.json())
        .then(data => setIsCaptain(data.data && data.data.length > 0))
        .catch(error => {
          logger.logSystem('check-captain-status-error', 'Error checking captain status', { userId: user?.id, error: error instanceof Error ? error.message : String(error) }, 'error')
          setIsCaptain(false)
        })
    }
  }, [user?.id])

  const navigation: NavItem[] = [
    { name: 'Dashboard', href: '/user', current: pathname === '/user' },
    { name: 'My Memberships', href: '/user/memberships', current: pathname === '/user/memberships' },
    { name: 'My Registrations', href: '/user/registrations', current: pathname === '/user/registrations' },
  ]

  if (isCaptain) {
    navigation.push({
      name: 'Captain',
      href: '/user/captain',
      current: pathname.startsWith('/user/captain'),
    })
  }

  if (user?.is_admin) {
    navigation.push({
      name: 'My Invoices',
      href: '/user/invoices',
      current: pathname === '/user/invoices',
      badge: hasUnpaid ? '!' : undefined,
    })
  }

  return <NavBar navigation={navigation} user={user} isAdminView={false} homeHref="/user" />
}
