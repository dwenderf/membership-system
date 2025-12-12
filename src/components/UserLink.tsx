'use client'

import Link from 'next/link'
import { buildBreadcrumbUrl, type Breadcrumb } from '@/lib/breadcrumb-utils'

interface UserLinkProps {
  userId: string
  firstName: string | null
  lastName: string | null
  xeroCustomerName?: string | null
  showAvatar?: boolean
  useXeroName?: boolean
  className?: string
  fromPath?: string
  fromLabel?: string
}

function getInitials(firstName: string | null, lastName: string | null, xeroName?: string | null): string {
  if (xeroName) {
    const parts = xeroName.trim().split(/\s+/)
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    }
    return xeroName.substring(0, 2).toUpperCase()
  }

  const first = firstName?.trim() || ''
  const last = lastName?.trim() || ''

  if (first && last) {
    return `${first[0]}${last[0]}`.toUpperCase()
  }
  if (first) {
    return first.substring(0, 2).toUpperCase()
  }
  if (last) {
    return last.substring(0, 2).toUpperCase()
  }

  return '??'
}

function getDisplayName(
  firstName: string | null,
  lastName: string | null,
  xeroName?: string | null,
  useXeroName?: boolean
): string {
  if (useXeroName && xeroName) {
    return xeroName
  }

  const first = firstName?.trim() || ''
  const last = lastName?.trim() || ''

  if (first && last) {
    return `${first} ${last}`
  }
  if (first) {
    return first
  }
  if (last) {
    return last
  }
  if (xeroName) {
    return xeroName
  }

  return 'Unknown User'
}

export default function UserLink({
  userId,
  firstName,
  lastName,
  xeroCustomerName,
  showAvatar = true,
  useXeroName = false,
  className = '',
  fromPath,
  fromLabel
}: UserLinkProps) {
  const displayName = getDisplayName(firstName, lastName, xeroCustomerName, useXeroName)
  const initials = getInitials(firstName, lastName, useXeroName ? xeroCustomerName : undefined)

  // Build URL with breadcrumb context if provided
  const basePath = `/admin/reports/users/${userId}`
  const href = fromPath && fromLabel
    ? buildBreadcrumbUrl(basePath, [], { path: fromPath, label: fromLabel })
    : basePath

  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 hover:opacity-75 transition-opacity ${className}`}
    >
      {showAvatar && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold">
          {initials}
        </div>
      )}
      <span className="text-indigo-600 hover:text-indigo-800 font-medium">
        {displayName}
      </span>
    </Link>
  )
}
