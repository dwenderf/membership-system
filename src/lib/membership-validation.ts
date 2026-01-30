// Utility functions for membership validation and season coverage

export interface UserMembership {
  id: string
  membership_id?: string
  valid_from: string
  valid_until: string
  membership?: {
    id: string
    name: string
    price_monthly?: number
    price_annual?: number
  }
  // Also support 'memberships' (plural) for compatibility with registration-validation-service
  memberships?: {
    id: string
    name: string
  }
}

export interface Season {
  start_date: string
  end_date: string
  name: string
}

export interface MembershipValidationResult {
  isValid: boolean
  membershipName?: string
  validUntil?: string
  seasonEndDate?: string
  monthsNeeded?: number
  daysShort?: number
}

/**
 * Check if user has valid membership coverage for the entire season
 */
export function validateMembershipCoverage(
  requiredMembershipId: string,
  userMemberships: UserMembership[],
  season: Season
): MembershipValidationResult {
  // Find the matching membership type with the latest expiration date
  // Support both 'membership' and 'memberships' field names, plus 'membership_id'
  const matchingMemberships = userMemberships.filter(um => {
    const membershipId = um.membership?.id || um.memberships?.id || um.membership_id
    return membershipId === requiredMembershipId
  })
  
  if (matchingMemberships.length === 0) {
    return {
      isValid: false,
      seasonEndDate: season.end_date,
      membershipName: undefined
    }
  }
  
  // Find the membership that expires latest (most recent extension)
  const relevantMembership = matchingMemberships.reduce((latest, current) => {
    return new Date(current.valid_until) > new Date(latest.valid_until) ? current : latest
  })

  const validUntilDate = new Date(relevantMembership.valid_until)
  const seasonEndDate = new Date(season.end_date)
  
  // Check if membership covers the entire season
  const isValid = validUntilDate >= seasonEndDate
  
  // Get membership name from either field
  const membershipName = relevantMembership.membership?.name || relevantMembership.memberships?.name

  if (isValid) {
    return {
      isValid: true,
      membershipName,
      validUntil: relevantMembership.valid_until
    }
  }

  // Calculate how many additional months are needed
  const daysDifference = Math.ceil((seasonEndDate.getTime() - validUntilDate.getTime()) / (1000 * 60 * 60 * 24))
  const monthsNeeded = Math.ceil(daysDifference / 30) // Rough estimate

  return {
    isValid: false,
    membershipName,
    validUntil: relevantMembership.valid_until,
    seasonEndDate: season.end_date,
    monthsNeeded,
    daysShort: daysDifference
  }
}

/**
 * Format the membership extension warning message
 */
export function formatMembershipWarning(validation: MembershipValidationResult): string {
  if (validation.isValid) return ''
  
  if (!validation.membershipName) {
    return `You need a membership to register for this category.`
  }

  const monthsText = validation.monthsNeeded === 1 ? 'month' : 'months'
  const daysText = validation.daysShort === 1 ? 'day' : 'days'
  
  return `Your ${validation.membershipName} expires ${validation.daysShort} ${daysText} before the season ends. You'll need to extend your membership by at least ${validation.monthsNeeded} ${monthsText} to cover the full season.`
}

/**
 * Calculate the cost for extending membership
 */
export function calculateExtensionCost(
  membership: UserMembership,
  monthsNeeded: number
): number {
  if (!membership.membership) return 0
  
  const monthlyPrice = membership.membership.price_monthly
  return monthsNeeded * monthlyPrice
}