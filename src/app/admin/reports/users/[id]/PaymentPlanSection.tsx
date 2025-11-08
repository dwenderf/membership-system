'use client'

import { useState, useEffect } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useRouter } from 'next/navigation'
import { formatAmount } from '@/lib/format-utils'
import { formatDate } from '@/lib/date-utils'

interface PaymentPlan {
  id: string
  registrationName: string
  seasonName: string
  totalAmount: number
  paidAmount: number
  remainingBalance: number
  installmentAmount: number
  installmentsCount: number
  installmentsPaid: number
  nextPaymentDate: string | null
  status: string
  createdAt: string
}

interface PaymentPlanSectionProps {
  userId: string
  initialPaymentPlanEnabled: boolean
  userName: string
}

export default function PaymentPlanSection({
  userId,
  initialPaymentPlanEnabled,
  userName
}: PaymentPlanSectionProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [paymentPlanEnabled, setPaymentPlanEnabled] = useState(initialPaymentPlanEnabled)
  const [paymentPlans, setPaymentPlans] = useState<PaymentPlan[]>([])
  const [plansLoading, setPlansLoading] = useState(true)
  const { showSuccess, showError } = useToast()
  const router = useRouter()

  // Fetch payment plans
  useEffect(() => {
    fetchPaymentPlans()
  }, [userId])

  const fetchPaymentPlans = async () => {
    try {
      const response = await fetch(`/api/admin/users/${userId}/payment-plans`)
      const data = await response.json()

      if (response.ok) {
        setPaymentPlans(data.plans || [])
      } else {
        console.error('Error fetching payment plans:', data.error)
      }
    } catch (error) {
      console.error('Error fetching payment plans:', error)
    } finally {
      setPlansLoading(false)
    }
  }

  const handleToggleEligibility = async () => {
    setIsLoading(true)

    try {
      const response = await fetch(`/api/admin/users/${userId}/payment-plan-eligibility`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: !paymentPlanEnabled })
      })

      const data = await response.json()

      if (response.ok && data.success) {
        const newStatus = data.user.payment_plan_enabled
        setPaymentPlanEnabled(newStatus)
        showSuccess(`Payment plans ${newStatus ? 'enabled' : 'disabled'} for ${userName}`)
        router.refresh()
      } else {
        showError(data.error || 'Failed to update payment plan eligibility')
      }
    } catch (error) {
      console.error('Error toggling payment plan eligibility:', error)
      showError('An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const activePlans = paymentPlans.filter(p => p.status === 'active')
  const completedPlans = paymentPlans.filter(p => p.status === 'completed')

  return (
    <div className="bg-white shadow rounded-lg mb-6">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-medium text-gray-900">Payment Plans</h2>
        <p className="mt-1 text-sm text-gray-600">
          Manage user's payment plan eligibility and view active plans
        </p>
      </div>

      <div className="px-6 py-4">
        <div className="space-y-6">
          {/* Eligibility Toggle */}
          <div className="flex items-center justify-between pb-4 border-b border-gray-200">
            <div>
              <h3 className="text-sm font-medium text-gray-900">Payment Plan Eligibility</h3>
              <p className="text-sm text-gray-500">
                Allow this user to pay for registrations in installments
              </p>
            </div>
            <button
              onClick={handleToggleEligibility}
              disabled={isLoading}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                isLoading
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : paymentPlanEnabled
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-gray-600 hover:bg-gray-700 text-white'
              }`}
            >
              {isLoading
                ? 'Updating...'
                : paymentPlanEnabled
                ? 'Enabled'
                : 'Disabled'
              }
            </button>
          </div>

          {/* Active Payment Plans */}
          {plansLoading ? (
            <div className="text-sm text-gray-500">Loading payment plans...</div>
          ) : activePlans.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-3">Active Payment Plans</h3>
              <div className="space-y-3">
                {activePlans.map((plan) => (
                  <div key={plan.id} className="bg-gray-50 rounded-lg p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h4 className="text-sm font-medium text-gray-900">
                          {plan.registrationName}
                        </h4>
                        {plan.seasonName && (
                          <p className="text-xs text-gray-500">{plan.seasonName}</p>
                        )}
                      </div>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        Active
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-gray-500">Total Amount:</span>
                        <span className="ml-2 font-medium">{formatAmount(plan.totalAmount)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Paid:</span>
                        <span className="ml-2 font-medium text-green-600">{formatAmount(plan.paidAmount)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Remaining:</span>
                        <span className="ml-2 font-medium text-orange-600">{formatAmount(plan.remainingBalance)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Progress:</span>
                        <span className="ml-2 font-medium">{plan.installmentsPaid}/{plan.installmentsCount} installments</span>
                      </div>
                    </div>

                    {plan.nextPaymentDate && (
                      <div className="mt-2 pt-2 border-t border-gray-200">
                        <span className="text-xs text-gray-500">Next Payment:</span>
                        <span className="ml-2 text-xs font-medium">{formatDate(new Date(plan.nextPaymentDate))}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : completedPlans.length > 0 ? (
            <div>
              <p className="text-sm text-gray-500 mb-2">No active payment plans</p>
              <p className="text-xs text-gray-400">{completedPlans.length} completed plan(s)</p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No payment plans found for this user</p>
          )}
        </div>
      </div>
    </div>
  )
}
