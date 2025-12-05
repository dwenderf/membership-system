'use client'

import Link from 'next/link'

export interface Breadcrumb {
  path: string
  label: string
}

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

/**
 * Utility function to build breadcrumb URL parameters
 */
export function buildBreadcrumbUrl(
  basePath: string,
  currentBreadcrumbs: Breadcrumb[],
  newBreadcrumb?: Breadcrumb
): string {
  const breadcrumbs = newBreadcrumb
    ? [...currentBreadcrumbs, newBreadcrumb]
    : currentBreadcrumbs

  if (breadcrumbs.length === 0) {
    return basePath
  }

  const params = new URLSearchParams()
  breadcrumbs.forEach((crumb, index) => {
    params.set(`back${index > 0 ? index + 1 : ''}`, crumb.path)
    params.set(`backLabel${index > 0 ? index + 1 : ''}`, crumb.label)
  })

  return `${basePath}?${params.toString()}`
}

/**
 * Utility function to parse breadcrumbs from URL search params
 */
export function parseBreadcrumbs(searchParams: URLSearchParams | { [key: string]: string | string[] | undefined }): Breadcrumb[] {
  const breadcrumbs: Breadcrumb[] = []

  // Convert to URLSearchParams if it's a plain object
  const params = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(Object.entries(searchParams).reduce((acc, [key, value]) => {
        if (value !== undefined) {
          acc[key] = Array.isArray(value) ? value[0] : value
        }
        return acc
      }, {} as Record<string, string>))

  // Check for first breadcrumb (back, backLabel)
  const back = params.get('back')
  const backLabel = params.get('backLabel')

  if (back && backLabel) {
    breadcrumbs.push({ path: back, label: backLabel })
  }

  // Check for additional breadcrumbs (back2/backLabel2, back3/backLabel3, etc.)
  let index = 2
  while (true) {
    const backN = params.get(`back${index}`)
    const backLabelN = params.get(`backLabel${index}`)

    if (backN && backLabelN) {
      breadcrumbs.push({ path: backN, label: backLabelN })
      index++
    } else {
      break
    }
  }

  return breadcrumbs
}
