'use client'

type Role = 'Administrator' | 'Captain' | 'Member'

interface RoleBadgeProps {
  role: Role
  className?: string
}

const roleStyles: Record<Role, string> = {
  Administrator: 'bg-purple-100 text-purple-800',
  Captain: 'bg-amber-100 text-amber-800',
  Member: 'bg-blue-100 text-blue-800',
}

/**
 * RoleBadge - A standardized badge component for user roles
 *
 * Provides consistent colors across the application:
 * - Administrator: Purple (bg-purple-100 text-purple-800)
 * - Captain: Amber (bg-amber-100 text-amber-800)
 * - Member: Blue (bg-blue-100 text-blue-800)
 *
 * @example
 * ```tsx
 * <RoleBadge role="Administrator" />
 * <RoleBadge role="Captain" />
 * <RoleBadge role={user.is_admin ? 'Administrator' : 'Member'} />
 * ```
 */
export default function RoleBadge({ role, className = '' }: RoleBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${roleStyles[role]} ${className}`}
    >
      {role}
    </span>
  )
}
