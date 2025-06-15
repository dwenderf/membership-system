// Utility functions for registration calculations

export interface Category {
  id: string
  name: string
  description: string | null
  category_type: 'system' | 'user'
  created_by: string | null
}

export interface RegistrationCategory {
  id: string
  registration_id: string
  category_id: string | null  // Reference to master categories
  custom_name: string | null  // One-off custom name
  max_capacity: number | null
  accounting_code: string | null
  required_membership_id: string | null  // Category-specific membership requirement
  sort_order: number
  // current_count is calculated dynamically from user_registrations
  
  // Joined data when fetched with category details
  categories?: Category
  memberships?: {
    id: string
    name: string
    price: number
  }
}

export interface RegistrationCategoryDisplay {
  id: string
  name: string  // Derived from categories.name OR custom_name
  max_capacity: number | null
  accounting_code: string | null
  required_membership_id: string | null
  required_membership_name: string | null  // For display
  sort_order: number
  is_custom: boolean  // True if using custom_name
}

export interface Registration {
  id: string
  name: string
  type: string
  registration_categories?: RegistrationCategory[]
}

/**
 * Get display name for a registration category
 */
export function getCategoryDisplayName(category: RegistrationCategory): string {
  return category.categories?.name || category.custom_name || 'Unknown Category'
}

/**
 * Check if a category is custom (one-off) vs reusable
 */
export function isCategoryCustom(category: RegistrationCategory): boolean {
  return category.custom_name !== null
}

/**
 * Convert registration category to display format
 */
export function toDisplayCategory(category: RegistrationCategory): RegistrationCategoryDisplay {
  return {
    id: category.id,
    name: getCategoryDisplayName(category),
    max_capacity: category.max_capacity,
    accounting_code: category.accounting_code,
    required_membership_id: category.required_membership_id,
    required_membership_name: category.memberships?.name || null,
    sort_order: category.sort_order,
    is_custom: isCategoryCustom(category)
  }
}

export interface RegistrationCategoryWithCount extends RegistrationCategory {
  current_count: number
}

/**
 * Calculate total capacity across all categories in a registration
 */
export function calculateTotalCapacity(categories: RegistrationCategoryWithCount[]): {
  totalCapacity: number | null
  totalCurrent: number
  hasCapacityLimits: boolean
} {
  if (!categories || categories.length === 0) {
    return {
      totalCapacity: null,
      totalCurrent: 0,
      hasCapacityLimits: false
    }
  }

  const hasCapacityLimits = categories.some(cat => cat.max_capacity !== null)
  const totalCapacity = hasCapacityLimits 
    ? categories.reduce((sum, cat) => sum + (cat.max_capacity || 0), 0)
    : null
  const totalCurrent = categories.reduce((sum, cat) => sum + cat.current_count, 0)

  return {
    totalCapacity,
    totalCurrent,
    hasCapacityLimits
  }
}

/**
 * Get all unique accounting codes from registration categories
 */
export function getAccountingCodes(categories: RegistrationCategory[]): string[] {
  if (!categories || categories.length === 0) {
    return []
  }

  return categories
    .map(cat => cat.accounting_code)
    .filter((code): code is string => code !== null && code.trim() !== '')
    .filter((code, index, array) => array.indexOf(code) === index) // unique values
}

/**
 * Check if registration is at capacity
 */
export function isRegistrationAtCapacity(categories: RegistrationCategoryWithCount[]): boolean {
  const { totalCapacity, totalCurrent, hasCapacityLimits } = calculateTotalCapacity(categories)
  return hasCapacityLimits && totalCapacity !== null && totalCurrent >= totalCapacity
}

/**
 * Get registration status based on categories
 */
export function getRegistrationStatus(
  categories: RegistrationCategoryWithCount[], 
  isSeasonEnded: boolean
): 'ended' | 'full' | 'open' {
  if (isSeasonEnded) return 'ended'
  if (isRegistrationAtCapacity(categories)) return 'full'
  return 'open'
}

/**
 * Format capacity display string
 */
export function formatCapacityDisplay(categories: RegistrationCategoryWithCount[]): string {
  const { totalCapacity, totalCurrent, hasCapacityLimits } = calculateTotalCapacity(categories)
  
  if (!hasCapacityLimits) {
    return totalCurrent > 0 ? `${totalCurrent} registered` : 'No registrations'
  }
  
  return `${totalCurrent}/${totalCapacity} spots`
}