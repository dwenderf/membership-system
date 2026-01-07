'use client'

interface RegistrationTypeBadgeProps {
  type: 'team' | 'scrimmage' | 'event'
  className?: string
}

/**
 * RegistrationTypeBadge - A standardized badge component for registration types
 *
 * Provides consistent colors across the application:
 * - Team: Blue (bg-blue-100 text-blue-800)
 * - Scrimmage: Orange (bg-orange-100 text-orange-800)
 * - Event: Purple (bg-purple-100 text-purple-800)
 *
 * Note: Green is reserved for status indicators (Active, Open, Paid)
 *
 * @example
 * ```tsx
 * <RegistrationTypeBadge type="team" />
 * <RegistrationTypeBadge type="scrimmage" className="ml-2" />
 * ```
 */
export default function RegistrationTypeBadge({ type, className = '' }: RegistrationTypeBadgeProps) {
  const getTypeStyles = () => {
    switch (type) {
      case 'team':
        return 'bg-blue-100 text-blue-800'
      case 'scrimmage':
        return 'bg-orange-100 text-orange-800'
      case 'event':
        return 'bg-purple-100 text-purple-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${getTypeStyles()} ${className}`}
    >
      {type}
    </span>
  )
}
