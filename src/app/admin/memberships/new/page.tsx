'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import AccountingCodeInput from '@/components/admin/AccountingCodeInput'

export default function NewMembershipPage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price_monthly: '', // in dollars, will convert to cents
    price_annual: '', // in dollars, will convert to cents
    accounting_code: '',
    allow_discounts: true,
    allow_monthly: true,
  })
  
  // Removed seasons state - no longer needed
  const [existingMemberships, setExistingMemberships] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [accountingCodesValid, setAccountingCodesValid] = useState<boolean | null>(null)
  const [accountingCodesError, setAccountingCodesError] = useState('')

  // Fetch existing memberships to check for duplicates
  useEffect(() => {
    const fetchData = async () => {
      // First validate accounting codes
      try {
        const response = await fetch('/api/validate-accounting-codes')
        if (response.ok) {
          const validation = await response.json()
          setAccountingCodesValid(validation.isValid)
          if (!validation.isValid) {
            setAccountingCodesError(validation.message)
          }
        } else {
          setAccountingCodesValid(false)
          setAccountingCodesError('Failed to validate accounting codes')
        }
      } catch (error) {
        setAccountingCodesValid(false)
        setAccountingCodesError('Failed to validate accounting codes')
      }

      const { data: membershipsData, error: membershipsError } = await supabase
        .from('memberships')
        .select('name')
      
      if (!membershipsError && membershipsData) {
        setExistingMemberships(membershipsData)
      }
    }
    
    fetchData()
  }, [])

  // Removed auto-generation - user will create membership types manually

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!canCreateMembership) {
      return
    }
    
    setLoading(true)
    setError('')

    try {
      // Convert prices from dollars to cents
      const monthlyPriceInCents = Math.round(parseFloat(formData.price_monthly) * 100)
      const annualPriceInCents = Math.round(parseFloat(formData.price_annual) * 100)
      
      if (isNaN(monthlyPriceInCents) || monthlyPriceInCents < 0) {
        setError('Please enter a valid monthly price (0 or greater)')
        setLoading(false)
        return
      }
      
      if (isNaN(annualPriceInCents) || annualPriceInCents < 0) {
        setError('Please enter a valid annual price (0 or greater)')
        setLoading(false)
        return
      }
      
      // Validate pricing logic with clear user-friendly messages
      if (formData.allow_monthly && monthlyPriceInCents > 0) {
        // When monthly pricing is enabled and has a price, annual should offer savings
        if (annualPriceInCents >= monthlyPriceInCents * 12) {
          setError('Annual price should be less than 12 times the monthly price to offer savings. Consider reducing the annual price or increasing the monthly price.')
          setLoading(false)
          return
        }
      } else if (!formData.allow_monthly && annualPriceInCents === 0) {
        // When monthly is disabled, annual must have a price
        setError('Annual price is required when monthly pricing is disabled.')
        setLoading(false)
        return
      }

      if (!formData.accounting_code.trim()) {
        setError('Accounting code is required')
        setLoading(false)
        return
      }

      const membershipData = {
        name: formData.name,
        description: formData.description || null,
        price_monthly: monthlyPriceInCents,
        price_annual: annualPriceInCents,
        accounting_code: formData.accounting_code.trim(),
        allow_discounts: formData.allow_discounts,
        allow_monthly: formData.allow_monthly,
      }

      const { error: insertError } = await supabase
        .from('memberships')
        .insert([membershipData])

      if (insertError) {
        setError(insertError.message)
      } else {
        router.push('/admin/memberships')
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Removed season selection logic
  
  // Check for duplicate membership name
  const membershipNameExists = existingMemberships.some(membership => 
    membership.name.toLowerCase() === formData.name.trim().toLowerCase()
  )
  
  const canCreateMembership = formData.name.trim() && 
                             (formData.allow_monthly ? (formData.price_monthly !== '' && parseFloat(formData.price_monthly) >= 0) : true) &&
                             formData.price_annual !== '' && 
                             parseFloat(formData.price_annual) >= 0 &&
                             formData.accounting_code.trim() &&
                             !membershipNameExists &&
                             accountingCodesValid

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Create New Membership Type</h1>
            <p className="mt-1 text-sm text-gray-600">
              Set up a flexible membership type with monthly and annual pricing
            </p>
          </div>

          {/* Accounting codes validation */}
          {accountingCodesValid === false && (
            <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-md p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-yellow-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-yellow-800">
                    Accounting Codes Required
                  </h3>
                  <div className="mt-2 text-sm text-yellow-700">
                    <p>{accountingCodesError}</p>
                  </div>
                  <div className="mt-4">
                    <Link
                      href="/admin/accounting-codes"
                      className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-yellow-800 bg-yellow-50 hover:bg-yellow-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
                    >
                      Configure Accounting Codes
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Info Notice */}
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-800">Flexible Duration Memberships</h3>
                <p className="mt-2 text-sm text-blue-700">
                  Create membership types that users can purchase for flexible durations. Users will choose how many months they need or purchase an annual plan for savings.
                </p>
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="bg-white shadow rounded-lg">
            <form onSubmit={handleSubmit} className="space-y-6 p-6">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
                  {error}
                </div>
              )}

              {/* Membership Name */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  Membership Type Name
                </label>
                <input
                  type="text"
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="e.g., Full Hockey Membership, Social Membership"
                  required
                />

              </div>

              {/* Description */}
              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                  Description
                </label>
                <textarea
                  id="description"
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="e.g., Includes access to all ice times, tournaments, and events"
                />

              </div>

              {/* Duplicate Name Warning */}
              {membershipNameExists && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-yellow-800">Warning</h3>
                      <ul className="mt-2 text-sm text-yellow-700 list-disc list-inside">
                        <li>A membership with the name "{formData.name}" already exists</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Allow Monthly Pricing */}
              <div className="flex items-center">
                <input
                  id="allow_monthly"
                  type="checkbox"
                  checked={formData.allow_monthly}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    allow_monthly: e.target.checked,
                    price_monthly: e.target.checked ? prev.price_monthly : '0'
                  }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="allow_monthly" className="ml-2 block text-sm text-gray-900">
                  Allow monthly pricing for this membership
                </label>
              </div>

              {/* Allow Discounts */}
              <div className="flex items-center">
                <input
                  id="allow_discounts"
                  type="checkbox"
                  checked={formData.allow_discounts}
                  onChange={(e) => setFormData(prev => ({ ...prev, allow_discounts: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="allow_discounts" className="ml-2 block text-sm text-gray-900">
                  Allow discount codes to be applied to this membership
                </label>
              </div>

              {/* Pricing */}
              <div className={`grid gap-6 ${formData.allow_monthly ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                {/* Monthly Price - Only show when allow_monthly is true */}
                {formData.allow_monthly && (
                  <div>
                    <label htmlFor="price_monthly" className="block text-sm font-medium text-gray-700">
                      Monthly Price (USD)
                    </label>
                    <div className="mt-1 relative rounded-md shadow-sm">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <span className="text-gray-500 sm:text-sm">$</span>
                      </div>
                      <input
                        type="number"
                        id="price_monthly"
                        step="0.01"
                        min="0"
                        value={formData.price_monthly}
                        onChange={(e) => setFormData(prev => ({ ...prev, price_monthly: e.target.value }))}
                        className="block w-full pl-7 pr-12 border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        placeholder="0.00"
                        required
                      />
                    </div>

                  </div>
                )}

                {/* Annual Price */}
                <div>
                  <label htmlFor="price_annual" className="block text-sm font-medium text-gray-700">
                    Annual Price (USD)
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="text-gray-500 sm:text-sm">$</span>
                    </div>
                    <input
                      type="number"
                      id="price_annual"
                      step="0.01"
                      min="0"
                      value={formData.price_annual}
                      onChange={(e) => setFormData(prev => ({ ...prev, price_annual: e.target.value }))}
                      className="block w-full pl-7 pr-12 border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                      placeholder="0.00"
                      required
                    />
                  </div>

                </div>
              </div>

              {/* Pricing Preview */}
              {formData.price_annual && (
                <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Pricing Summary</h4>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {formData.allow_monthly && formData.price_monthly && (
                      <>
                        <div>
                          <span className="text-sm text-gray-500">Monthly:</span>
                          <span className="ml-2 text-sm font-medium">${parseFloat(formData.price_monthly).toFixed(2)}/month</span>
                        </div>
                        <div>
                          <span className="text-sm text-gray-500">Annual savings:</span>
                          <span className="ml-2 text-sm font-medium text-green-600">
                            ${Math.max(0, (parseFloat(formData.price_monthly) * 12 - parseFloat(formData.price_annual))).toFixed(2)}
                          </span>
                        </div>
                      </>
                    )}
                    <div>
                      <span className="text-sm text-gray-500">Annual:</span>
                      <span className="ml-2 text-sm font-medium">${parseFloat(formData.price_annual).toFixed(2)}/year</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Accounting Code */}
              <AccountingCodeInput
                value={formData.accounting_code}
                onChange={(value) => setFormData(prev => ({ ...prev, accounting_code: value }))}
                label="Accounting Code"
                required
                placeholder="Search for accounting code..."
                accountType="REVENUE"
              />

              {/* Membership Preview */}
              {formData.name && (
                <div className={`border rounded-md p-4 ${membershipNameExists ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                  <h4 className="text-sm font-medium text-gray-900 mb-3">Membership Type Preview</h4>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Name</dt>
                      <dd className="text-sm text-gray-900">{formData.name}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Description</dt>
                      <dd className="text-sm text-gray-900">{formData.description || 'No description'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Monthly Price</dt>
                      <dd className="text-sm text-gray-900">${formData.price_monthly ? parseFloat(formData.price_monthly).toFixed(2) : '0.00'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Annual Price</dt>
                      <dd className="text-sm text-gray-900">${formData.price_annual ? parseFloat(formData.price_annual).toFixed(2) : '0.00'}</dd>
                    </div>
                  </dl>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex justify-end space-x-3">
                <Link
                  href="/admin/memberships"
                  className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={loading || !canCreateMembership}
                  className={`inline-flex justify-center items-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 ${
                    canCreateMembership && !loading
                      ? 'bg-blue-600 hover:bg-blue-700' 
                      : 'bg-gray-400 cursor-not-allowed'
                  }`}
                >
                  {loading && (
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  )}
                  {loading ? 'Creating Membership Type...' : canCreateMembership ? 'Create Membership Type' : 'Complete Form to Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}