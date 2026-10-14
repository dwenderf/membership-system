import { getRegistrationDateLabel } from '@/lib/registration-date-label'

interface RegistrationDateDisplayProps {
  type: 'team' | 'event' | 'scrimmage'
  startDate?: string | null
  seasonName?: string
  className?: string
}

/**
 * RegistrationDateDisplay - Display event date/time or season name based on registration type
 *
 * For events/scrimmages with a start_date: shows formatted date/time
 * For teams or events without dates: shows season name
 *
 * @example
 * ```tsx
 * <RegistrationDateDisplay
 *   type="scrimmage"
 *   startDate="2024-01-15T18:00:00Z"
 *   seasonName="Winter 2024"
 * />
 * ```
 */
export default function RegistrationDateDisplay({
  type,
  startDate,
  seasonName,
  className = 'text-sm text-gray-500'
}: RegistrationDateDisplayProps) {
  return (
    <p className={className}>
      {getRegistrationDateLabel({ type, startDate, seasonName }) ?? 'No season'}
    </p>
  )
}
