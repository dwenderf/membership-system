interface UserMembership {
  id: string
  user_id: string
  membership_id: string
  valid_from: string
  valid_until: string
  payment_status: string
  membership?: {
    id: string
    name: string
  }
}

export interface MembershipStatus {
  status: 'not_owned' | 'expired' | 'expiring_soon' | 'active'
  label: string
  className: string
  daysUntilExpiration?: number
  validUntil?: Date
}

/**
 * Determines the status of a specific membership type for a user
 * @param membershipId - The ID of the membership type to check
 * @param userMemberships - Array of user's membership records
 * @returns MembershipStatus object with status, label, and styling information
 */
export function getMembershipStatus(
  membershipId: string, 
  userMemberships: UserMembership[]
): MembershipStatus {
  const now = new Date()
  
  // Get all paid memberships for this specific type
  const paidMemberships = userMemberships.filter(
    um => um.payment_status === 'paid' && um.membership_id === membershipId
  )
  
  if (paidMemberships.length === 0) {
    return { 
      status: 'not_owned', 
      label: 'Available', 
      className: 'bg-blue-100 text-blue-800' 
    }
  }
  
  // Find the latest expiration date for this membership type
  const latestExpiration = Math.max(
    ...paidMemberships.map(um => new Date(um.valid_until).getTime())
  )
  const latestValidUntil = new Date(latestExpiration)
  
  if (latestValidUntil <= now) {
    return { 
      status: 'expired', 
      label: 'Expired', 
      className: 'bg-red-100 text-red-800',
      validUntil: latestValidUntil
    }
  }
  
  const daysUntilExpiration = Math.ceil(
    (latestValidUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  )
  const isExpiringSoon = daysUntilExpiration <= 90
  
  if (isExpiringSoon) {
    return { 
      status: 'expiring_soon', 
      label: 'Expiring Soon', 
      className: 'bg-yellow-100 text-yellow-800',
      daysUntilExpiration,
      validUntil: latestValidUntil
    }
  }
  
  return { 
    status: 'active', 
    label: 'Active', 
    className: 'bg-green-100 text-green-800',
    daysUntilExpiration,
    validUntil: latestValidUntil
  }
}

/**
 * Consolidates user memberships by type, finding the latest expiration for each type
 * @param userMemberships - Array of user's membership records
 * @returns Array of consolidated memberships with combined validity periods
 */
export function consolidateUserMemberships(userMemberships: UserMembership[]) {
  const now = new Date()
  
  // Get all paid memberships for processing
  const paidMemberships = userMemberships.filter(um => um.payment_status === 'paid')
  
  // Consolidate active memberships by type
  const consolidated = paidMemberships.reduce((acc, um) => {
    const validUntil = new Date(um.valid_until)
    
    // Only include if still valid
    if (validUntil > now) {
      const membershipId = um.membership_id
      
      if (!acc[membershipId]) {
        acc[membershipId] = {
          membershipId,
          membership: um.membership,
          validFrom: um.valid_from,
          validUntil: um.valid_until,
          purchases: []
        }
      }
      
      // Update overall validity period
      if (um.valid_from < acc[membershipId].validFrom) {
        acc[membershipId].validFrom = um.valid_from
      }
      if (um.valid_until > acc[membershipId].validUntil) {
        acc[membershipId].validUntil = um.valid_until
      }
      
      acc[membershipId].purchases.push(um)
    }
    
    return acc
  }, {} as Record<string, any>)
  
  return Object.values(consolidated)
}