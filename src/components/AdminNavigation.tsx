'use client'

import { usePathname } from 'next/navigation'
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

interface AdminNavigationProps {
  user: User | null
}

export default function AdminNavigation({ user }: AdminNavigationProps) {
  const pathname = usePathname()

  const navigation: NavItem[] = [
    {
      name: 'Dashboard',
      href: '/admin',
      current: pathname === '/admin',
    },
    {
      name: 'Management',
      href: '/admin/seasons',
      current:
        pathname.startsWith('/admin/seasons') ||
        pathname.startsWith('/admin/memberships') ||
        pathname.startsWith('/admin/registrations') ||
        pathname.startsWith('/admin/alternates'),
      submenu: [
        { name: 'Seasons', href: '/admin/seasons' },
        { name: 'Memberships', href: '/admin/memberships' },
        { name: 'Registrations', href: '/admin/registrations' },
        { name: 'Alternates', href: '/admin/alternates' },
      ],
    },
    {
      name: 'Configuration',
      href: '/admin/discount-categories',
      current:
        pathname.startsWith('/admin/discount-categories') ||
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
        { name: 'Security Logs', href: '/admin/security' },
      ],
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
        { name: 'Discount Eligibility', href: '/admin/reports/discount-eligibility' },
        { name: 'Payment Plans', href: '/admin/reports/payment-plans' },
        { name: 'User Reports', href: '/admin/reports/users' },
      ],
    },
  ]

  return <NavBar navigation={navigation} user={user} isAdminView={true} homeHref="/admin" />
}
