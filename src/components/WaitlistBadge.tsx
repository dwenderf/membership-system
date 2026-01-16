/**
 * WaitlistBadge - Standardized badge for waitlist status
 *
 * Uses yellow styling to indicate pending/waitlist status,
 * differentiating from blue (paid registration) badges.
 */
export default function WaitlistBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 ${className}`}>
      Waitlist
    </span>
  )
}
