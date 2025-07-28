/**
 * Utility functions for membership-related calculations
 */

/**
 * Calculate the start date for a new membership purchase
 * 
 * @param membershipId - The ID of the membership being purchased
 * @param userMemberships - Array of user's existing memberships
 * @param currentDate - Current date (defaults to now)
 * @returns The calculated start date
 */
export function calculateMembershipStartDate(
  membershipId: string,
  userMemberships: Array<{
    valid_until: string
    membership?: {
      id: string
    }
  }> = [],
  currentDate: Date = new Date()
): Date {
  // Check if user has existing valid memberships of the same type
  const currentMembershipsOfSameType = userMemberships.filter(
    um => um.membership?.id === membershipId && new Date(um.valid_until) > currentDate
  )
  
  if (currentMembershipsOfSameType.length > 0) {
    // Extension: start from end of current membership
    const latestExpiration = currentMembershipsOfSameType.reduce((latest, current) => {
      return new Date(current.valid_until) > new Date(latest.valid_until) ? current : latest
    })
    return new Date(latestExpiration.valid_until)
  }
  
  // New membership: check if we're before September 1, 2025
  // Create September 1, 2025 at midnight in local timezone to avoid timezone issues
  const septemberFirst2025 = new Date(2025, 8, 1) // Month is 0-indexed, so 8 = September
  
  if (currentDate < septemberFirst2025) {
    // Before September 1, 2025: start on September 1, 2025
    return septemberFirst2025
  }
  
  // After September 1, 2025: start today
  return currentDate
}

/**
 * Calculate the end date for a membership based on start date and duration
 * 
 * @param startDate - The start date of the membership
 * @param durationMonths - Duration in months
 * @returns The calculated end date
 */
export function calculateMembershipEndDate(startDate: Date, durationMonths: number): Date {
  const endDate = new Date(startDate)
  
  // Use a more reliable method to add months that handles edge cases
  const year = endDate.getFullYear()
  const month = endDate.getMonth()
  const day = endDate.getDate()
  
  // Calculate new month and year
  const newMonth = month + durationMonths
  const newYear = year + Math.floor(newMonth / 12)
  const finalMonth = newMonth % 12
  
  // Set the new date, ensuring we don't exceed the last day of the month
  const lastDayOfMonth = new Date(newYear, finalMonth + 1, 0).getDate()
  const finalDay = Math.min(day, lastDayOfMonth)
  
  endDate.setFullYear(newYear, finalMonth, finalDay)
  return endDate
}

/**
 * Calculate both start and end dates for a membership purchase
 * 
 * @param membershipId - The ID of the membership being purchased
 * @param durationMonths - Duration in months
 * @param userMemberships - Array of user's existing memberships
 * @param currentDate - Current date (defaults to now)
 * @returns Object with startDate and endDate
 */
export function calculateMembershipDates(
  membershipId: string,
  durationMonths: number,
  userMemberships: Array<{
    valid_until: string
    membership?: {
      id: string
    }
  }> = [],
  currentDate: Date = new Date()
): { startDate: Date; endDate: Date } {
  const startDate = calculateMembershipStartDate(membershipId, userMemberships, currentDate)
  const endDate = calculateMembershipEndDate(startDate, durationMonths)
  
  return { startDate, endDate }
}

/**
 * Check if a membership purchase is an extension of an existing membership
 * 
 * @param startDate - The calculated start date
 * @param currentDate - Current date (defaults to now)
 * @returns True if this is an extension
 */
export function isMembershipExtension(startDate: Date, currentDate: Date = new Date()): boolean {
  return startDate > currentDate
} 