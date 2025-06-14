// Utility functions for registration calculations

export interface RegistrationCategory {
  id: string
  name: string
  max_capacity: number | null
  current_count: number
  accounting_code: string | null
}

export interface Registration {
  id: string
  name: string
  type: string
  registration_categories?: RegistrationCategory[]
}

/**
 * Calculate total capacity across all categories in a registration
 */
export function calculateTotalCapacity(categories: RegistrationCategory[]): {
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
export function isRegistrationAtCapacity(categories: RegistrationCategory[]): boolean {
  const { totalCapacity, totalCurrent, hasCapacityLimits } = calculateTotalCapacity(categories)
  return hasCapacityLimits && totalCapacity !== null && totalCurrent >= totalCapacity
}

/**
 * Get registration status based on categories
 */
export function getRegistrationStatus(
  categories: RegistrationCategory[], 
  isSeasonEnded: boolean
): 'ended' | 'full' | 'open' {
  if (isSeasonEnded) return 'ended'
  if (isRegistrationAtCapacity(categories)) return 'full'
  return 'open'
}

/**
 * Format capacity display string
 */
export function formatCapacityDisplay(categories: RegistrationCategory[]): string {
  const { totalCapacity, totalCurrent, hasCapacityLimits } = calculateTotalCapacity(categories)
  
  if (!hasCapacityLimits) {
    return totalCurrent > 0 ? `${totalCurrent} registered` : 'No registrations'
  }
  
  return `${totalCurrent}/${totalCapacity} spots`
}