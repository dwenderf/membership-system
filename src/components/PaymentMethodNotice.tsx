'use client'

import { useState, useEffect } from 'react'
import { formatPaymentMethodDescription, extractPaymentMethodInfo, type PaymentMethodInfo } from '@/lib/payment-method-utils'

interface PaymentMethodNoticeProps {
  userEmail: string
  onSavePaymentChange?: (shouldSave: boolean) => void
  showForAlternate?: boolean // Different messaging for alternate registrations
}

// PaymentMethodInfo is now imported from utils

export default function PaymentMethodNotice({ 
  userEmail, 
  onSavePaymentChange, 
  showForAlternate = false 
}: PaymentMethodNoticeProps) {
  const [paymentInfo, setPaymentInfo] = useState<PaymentMethodInfo | null>(null)
  const [shouldSavePayment, setShouldSavePayment] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchPaymentMethodInfo()
  }, [])

  useEffect(() => {
    onSavePaymentChange?.(shouldSavePayment)
  }, [shouldSavePayment, onSavePaymentChange])

  const fetchPaymentMethodInfo = async () => {
    try {
      const response = await fetch('/api/user-payment-method')
      if (response.ok) {
        const data = await response.json()
        setPaymentInfo(extractPaymentMethodInfo(data))
      } else {
        setPaymentInfo({ hasPaymentMethod: false })
      }
    } catch (error) {
      console.error('Error fetching payment method:', error)
      setPaymentInfo({ hasPaymentMethod: false })
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="text-sm text-gray-500">Loading payment information...</div>
      </div>
    )
  }

  if (!paymentInfo) {
    return null
  }

  // User has a saved payment method
  if (paymentInfo.hasPaymentMethod) {
    const cardDisplay = formatPaymentMethodDescription(paymentInfo)

    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-medium text-blue-900">
              {showForAlternate ? 'Automatic Billing Enabled' : 'Payment Method Saved'}
            </h4>
            <div className="mt-1 text-sm text-blue-700">
              {showForAlternate ? (
                <>
                  By registering as an alternate, you authorize us to automatically charge your saved payment method ({cardDisplay}) if you are selected for a game.
                </>
              ) : (
                <>
                  We'll use your saved payment method ({cardDisplay}) for this purchase.
                </>
              )}
            </div>
            <div className="mt-2 text-xs text-blue-600">
              You can manage your payment methods in your <a href="/user/account" className="underline hover:text-blue-500">account settings</a>.
            </div>
          </div>
        </div>
      </div>
    )
  }

  // User doesn't have a saved payment method
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
      <div className="flex items-start space-x-3">
        <input
          type="checkbox"
          id="save-payment-method"
          checked={shouldSavePayment}
          onChange={(e) => setShouldSavePayment(e.target.checked)}
          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
        />
        <div className="flex-1">
          <label htmlFor="save-payment-method" className="text-sm font-medium text-gray-900 cursor-pointer">
            Save payment information for future purchases
          </label>
          <div className="mt-1 text-sm text-gray-600">
            This will save your payment method securely with Stripe for faster checkout on future registrations and memberships.
          </div>
          {shouldSavePayment && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <div className="text-xs text-blue-800">
                <div className="font-medium mb-1">How payment saving works:</div>
                <ul className="space-y-1 list-disc list-inside">
                  <li>Your payment information is securely stored by Stripe, not on our servers</li>
                  <li>We never see or store your full card number or security code</li>
                  <li>You can remove saved payment methods anytime in your account settings</li>
                  <li>Saved methods can be used for future registrations, memberships, and alternate selections</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}