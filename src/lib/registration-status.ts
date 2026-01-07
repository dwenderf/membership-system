// Utility functions for determining registration status and availability

export type RegistrationStatus =
  | 'draft'        // is_active = false
  | 'expired'      // past registration_end_at
  | 'past'         // event/scrimmage with start_date in the past
  | 'coming_soon'  // before presale_start_at or regular_start_at
  | 'presale'      // between presale_start_at and regular_start_at
  | 'open'         // after regular_start_at or no timing restrictions

export interface RegistrationWithTiming {
  id: string
  type: string
  is_active: boolean
  presale_start_at: string | null
  regular_start_at: string | null
  registration_end_at: string | null
  presale_code: string | null
  start_date: string | null
  end_date: string | null
}

/**
 * Determine the current status of a registration
 */
export function getRegistrationStatus(registration: RegistrationWithTiming): RegistrationStatus {
  const now = new Date()

  // Draft mode - never visible to users
  if (!registration.is_active) {
    return 'draft'
  }

  // For events and scrimmages, check if the event has already ended
  if ((registration.type === 'event' || registration.type === 'scrimmage') && registration.end_date) {
    const eventEndDate = new Date(registration.end_date)
    if (now > eventEndDate) {
      return 'past'
    }
  }

  // Check if registration has ended
  if (registration.registration_end_at) {
    const endDate = new Date(registration.registration_end_at)
    if (now > endDate) {
      return 'expired'
    }
  }

  // Check presale timing
  if (registration.presale_start_at) {
    const presaleStart = new Date(registration.presale_start_at)

    // Before presale starts
    if (now < presaleStart) {
      return 'coming_soon'
    }

    // During presale period (if regular start is also configured)
    if (registration.regular_start_at) {
      const regularStart = new Date(registration.regular_start_at)
      if (now >= presaleStart && now < regularStart) {
        return 'presale'
      }
    }
  }

  // Check regular start timing
  if (registration.regular_start_at) {
    const regularStart = new Date(registration.regular_start_at)

    // Before regular registration starts (and no presale or presale hasn't started)
    if (now < regularStart) {
      return 'coming_soon'
    }
  }

  // Registration is open
  return 'open'
}

/**
 * Check if registration is available for purchase
 */
export function isRegistrationAvailable(registration: RegistrationWithTiming, hasPresaleCode: boolean = false): boolean {
  const status = getRegistrationStatus(registration)

  switch (status) {
    case 'draft':
    case 'expired':
    case 'past':
    case 'coming_soon':
      return false
    case 'presale':
      return hasPresaleCode
    case 'open':
      return true
    default:
      return false
  }
}

/**
 * Get user-friendly status display text
 */
export function getStatusDisplayText(status: RegistrationStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'expired':
      return 'Registration Closed'
    case 'past':
      return 'Past'
    case 'coming_soon':
      return 'Coming Soon'
    case 'presale':
      return 'Pre-Sale'
    case 'open':
      return 'Open'
    default:
      return 'Unknown'
  }
}

/**
 * Get status badge styling
 */
export function getStatusBadgeStyle(status: RegistrationStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-gray-100 text-gray-800'
    case 'expired':
      return 'bg-red-100 text-red-800'
    case 'past':
      return 'bg-red-100 text-red-800'
    case 'coming_soon':
      return 'bg-yellow-100 text-yellow-800'
    case 'presale':
      return 'bg-purple-100 text-purple-800'
    case 'open':
      return 'bg-green-100 text-green-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}