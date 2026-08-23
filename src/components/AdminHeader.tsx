'use client'

import Link from 'next/link'

interface AdminHeaderProps {
  title: string
  description?: string
  backLink?: string
}

export default function AdminHeader({ title, description, backLink }: AdminHeaderProps) {
  return (
    <div className="mb-8">
      {backLink && (
        <Link
          href={backLink}
          className="text-blue-600 hover:text-blue-500 text-sm font-medium"
        >
          ← Back
        </Link>
      )}
      <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
      {description && (
        <p className="mt-1 text-sm text-gray-600">{description}</p>
      )}
    </div>
  )
}
