'use client'

import Link from 'next/link'
import type { Breadcrumb } from '@/lib/breadcrumb-utils'

interface BreadcrumbNavProps {
  breadcrumbs: Breadcrumb[]
  position?: 'top' | 'bottom'
}

export default function BreadcrumbNav({ breadcrumbs, position = 'top' }: BreadcrumbNavProps) {
  if (breadcrumbs.length === 0) {
    return null
  }

  return (
    <nav className={`flex flex-col gap-1 ${position === 'top' ? 'mb-4' : 'mt-6 pt-6 border-t border-gray-200'}`}>
      {breadcrumbs.map((breadcrumb, index) => (
        <Link
          key={`${breadcrumb.path}-${index}`}
          href={breadcrumb.path}
          className="inline-flex items-center text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors w-fit"
        >
          <svg
            className="w-4 h-4 mr-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          {breadcrumb.label}
        </Link>
      ))}
    </nav>
  )
}

// Re-export utility functions from the server-safe module
export { buildBreadcrumbUrl, parseBreadcrumbs, type Breadcrumb } from '@/lib/breadcrumb-utils'
