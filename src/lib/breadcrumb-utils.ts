// Server-safe breadcrumb utilities (no 'use client')

export interface Breadcrumb {
  path: string
  label: string
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
