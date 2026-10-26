/**
 * WaitlistPaymentPlanBadge - shows a waitlisted member's payment-plan choice (#442) on the
 * admin and captain waitlist tables. Renders nothing if they didn't choose a plan.
 *
 * If they chose a plan but are no longer eligible, selection charges in full, so the badge
 * says so rather than implying a plan will be set up.
 */
export default function WaitlistPaymentPlanBadge({
  usePaymentPlan,
  eligible,
  className = '',
}: {
  usePaymentPlan: boolean
  eligible: boolean
  className?: string
}) {
  if (!usePaymentPlan) return null

  if (!eligible) {
    return (
      <span
        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 ${className}`}
        title="Chose a payment plan but is no longer eligible. Selecting will charge the full amount."
      >
        Plan unavailable · full charge
      </span>
    )
  }

  return (
    <span
      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 ${className}`}
      title="Selecting will charge the first of 4 installments."
    >
      Payment plan
    </span>
  )
}
