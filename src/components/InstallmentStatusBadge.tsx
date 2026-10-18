import type { InstallmentDisplayStatus } from '@/lib/payment-plan-utils'

const BADGES: Record<InstallmentDisplayStatus, { label: string; className: string }> = {
  paid: { label: 'Paid', className: 'bg-green-100 text-green-800' },
  scheduled: { label: 'Scheduled', className: 'bg-gray-100 text-gray-700' },
  failing: { label: 'Failing – will retry', className: 'bg-orange-100 text-orange-800' },
  exhausted: { label: 'Failed – retries used up', className: 'bg-red-100 text-red-800' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800' }
}

export default function InstallmentStatusBadge({ status }: { status: InstallmentDisplayStatus }) {
  const badge = BADGES[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.className}`}>
      {badge.label}
    </span>
  )
}
