// Utility functions for membership validation and season coverage

import { formatDateString } from '@/lib/date-utils'

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

export interface MembershipRequirementOption {
  id: string
  name: string
}

interface RequirementUserMembership {
  membership_id?: string
  valid_until: string
}

/**
 * Build the "Requires: ..." text for a registration category.
 *
 * Collapses duplicate requirement options (e.g. a registration-level and
 * category-level requirement that happen to point at the same membership),
 * and — when the user already holds one of the required memberships but it
 * expires before the season ends — appends a note telling them to extend it.
 * When two *different* memberships would each satisfy the requirement, the
 * note stays generic since it's ambiguous which one they should extend.
 */
export function formatMembershipRequirementText(
  requirements: MembershipRequirementOption[],
  userMemberships: RequirementUserMembership[],
  seasonEndDate?: string | null
): string {
  const uniqueRequirements = requirements.filter(
    (requirement, index) => requirements.findIndex(r => r.id === requirement.id) === index
  )

  const baseText = uniqueRequirements.map(r => r.name).join(' OR ') || 'Membership'

  if (!seasonEndDate || uniqueRequirements.length === 0) return baseText

  const requirementIds = uniqueRequirements.map(r => r.id)
  const matchingMemberships = userMemberships.filter(
    um => um.membership_id && requirementIds.includes(um.membership_id)
  )

  if (matchingMemberships.length === 0) return baseText

  const latestMatch = matchingMemberships.reduce((latest, current) =>
    new Date(current.valid_until) > new Date(latest.valid_until) ? current : latest
  )

  const coversFullSeason = new Date(latestMatch.valid_until) >= new Date(seasonEndDate)
  if (coversFullSeason) return baseText

  const extensionNote = 'You need to extend your membership in order to register.'

  if (uniqueRequirements.length === 1) {
    return `${uniqueRequirements[0].name} valid until ${formatDateString(latestMatch.valid_until)}. ${extensionNote}`
  }

  return `${baseText}. ${extensionNote}`
}

/**
 * Validate the "how much are you able to pay?" field on an assistance
 * purchase. Returns an error message when the value is blank, non-numeric,
 * negative, or exceeds the membership price; null when it's a valid amount.
 *
 * requestedAmount is the raw string from the input field (dollars).
 * priceCents is the full membership price in cents.
 */
export function validateAssistanceAmount(
  requestedAmount: string,
  priceCents: number
): string | null {
  const trimmed = requestedAmount.trim()
  const parsed = parseFloat(trimmed)
  if (trimmed === '' || isNaN(parsed) || parsed < 0 || parsed * 100 > priceCents) {
    return `Please enter a valid amount between $0 and $${(priceCents / 100).toFixed(2)}`
  }
  return null
}