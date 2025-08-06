/**
 * Helper functions for displaying user attributes consistently across reports
 */

/**
 * Convert raw LGBTQ boolean to display label
 */
export function getLgbtqStatusLabel(isLgbtq: boolean | null): string {
  if (isLgbtq === true) return 'LGBTQ+'
  if (isLgbtq === false) return 'Ally'
  return 'No Response'
}

/**
 * Get CSS classes for LGBTQ status pill styling
 */
export function getLgbtqStatusStyles(isLgbtq: boolean | null): string {
  if (isLgbtq === true) return 'bg-purple-100 text-purple-800'
  if (isLgbtq === false) return 'bg-blue-100 text-blue-800'
  return 'bg-gray-100 text-gray-800'
}

/**
 * Convert raw goalie boolean to display label
 */
export function getGoalieStatusLabel(isGoalie: boolean): string {
  return isGoalie ? 'Goalie' : 'No'
}

/**
 * Get CSS classes for goalie status pill styling
 */
export function getGoalieStatusStyles(isGoalie: boolean): string {
  return isGoalie ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
}

/**
 * Get CSS classes for category pill styling
 */
export function getCategoryPillStyles(): string {
  return 'bg-indigo-100 text-indigo-800'
}