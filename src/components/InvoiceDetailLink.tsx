'use client'

import Link from 'next/link'
import { buildBreadcrumbUrl } from '@/lib/breadcrumb-utils'

interface InvoiceDetailLinkProps {
  userId: string
  invoiceId: string
  label?: string
  showIcon?: boolean
  className?: string
  fromPath?: string
  fromLabel?: string
}

export default function InvoiceDetailLink({
  userId,
  invoiceId,
  label = 'Detail',
  showIcon = false,
  className = '',
  fromPath,
  fromLabel
}: InvoiceDetailLinkProps) {
  // Build URL with breadcrumb context if provided
  const basePath = `/admin/reports/users/${userId}/invoices/${invoiceId}`
  const href = fromPath && fromLabel
    ? buildBreadcrumbUrl(basePath, [], { path: fromPath, label: fromLabel })
    : basePath

  return (
    <Link
      href={href}
      className={`inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-indigo-700 bg-indigo-50 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${className}`}
    >
      {showIcon && (
        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )}
      {label}
    </Link>
  )
}
