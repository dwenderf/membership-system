'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'

interface Membership {
  id: string
  name: string
  description: string | null
  accounting_code: string | null
  price_monthly: number
  price_annual: number
  allow_discounts: boolean
  allow_monthly: boolean
  created_at: string
}

export default function EditMembershipPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const supabase = createClient()
  const { showError, showSuccess } = useToast()
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price_monthly: '', // in dollars, will convert to cents
    price_annual: '', // in dollars, will convert to cents
    accounting_code: '',
    allow_discounts: true,
    allow_monthly: true,
  })
  
  const [existingMemberships, setExistingMemberships] = useState<any[]>([])
  const [currentMembership, setCurrentMembership] = useState<Membership | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)

  // Fetch existing memberships and current membership
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        // Fetch current membership
        const { data: membershipData, error: membershipError } = await supabase
          .from('memberships')
          .select('*')
          .eq('id', resolvedParams.id)
          .single()
        
        if (membershipError) {
          showError('Membership not found')
          router.push('/admin/memberships')
          return
        }

        setCurrentMembership(membershipData)
        setFormData({
          name: membershipData.name,
          description: membershipData.description || '',
          price_monthly: (membershipData.price_monthly / 100).toString(),
          price_annual: (membershipData.price_annual / 100).toString(),
          accounting_code: membershipData.accounting_code || '',
          allow_discounts: membershipData.allow_discounts,
          allow_monthly: membershipData.allow_monthly ?? true, // Default to true for existing records
        })

        // Fetch other memberships to check for duplicates
        const { data: membershipsData, error: membershipsError } = await supabase
          .from('memberships')
          .select('id, name')
          .neq('id', resolvedParams.id) // Exclude current membership
        
        if (!membershipsError && membershipsData) {
          setExistingMemberships(membershipsData)
        }
      } catch (error) {
        console.error('Error fetching data:', error)
        showError('Error loading membership')
        router.push('/admin/memberships')
      } finally {
        setLoading(false)
      }
    }
    
    fetchData()
  }, [resolvedParams.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!canUpdateMembership) {
      return
    }
    
    setUpdating(true)

    try {
      // Convert prices from dollars to cents
      const monthlyPriceInCents = Math.round(parseFloat(formData.price_monthly) * 100)
      const annualPriceInCents = Math.round(parseFloat(formData.price_annual) * 100)
      
      if (isNaN(monthlyPriceInCents) || monthlyPriceInCents < 0) {
        showError('Please enter a valid monthly price (0 or greater)')
        setUpdating(false)
        return
      }
      
      if (isNaN(annualPriceInCents) || annualPriceInCents < 0) {
        showError('Please enter a valid annual price (0 or greater)')
        setUpdating(false)
        return
      }
      
      // Basic validation - ensure annual pricing offers some discount when monthly is available
      if (formData.allow_monthly && monthlyPriceInCents > 0 && annualPriceInCents >= monthlyPriceInCents * 12) {
        showError('Annual price should be less than 12 times the monthly price')
        setUpdating(false)
        return
      }

      if (!formData.accounting_code.trim()) {
        showError('Accounting code is required')
        setUpdating(false)
        return
      }

      const membershipData = {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        price_monthly: monthlyPriceInCents,
        price_annual: annualPriceInCents,
        accounting_code: formData.accounting_code.trim(),
        allow_discounts: formData.allow_discounts,
        allow_monthly: formData.allow_monthly,
      }

      const response = await fetch(`/api/admin/memberships/${resolvedParams.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(membershipData),
      })

      const responseData = await response.json()

      if (!response.ok) {
        showError(responseData.error || 'Failed to update membership')
      } else {
        showSuccess('Membership updated successfully')
        router.push('/admin/memberships')
      }
    } catch (err) {
      showError('An unexpected error occurred')
    } finally {
      setUpdating(false)
    }
  }
  
  // Check for duplicate membership name
  const membershipNameExists = existingMemberships.some(membership => 
    membership.name.toLowerCase() === formData.name.trim().toLowerCase()
  )
  
  const canUpdateMembership = formData.name.trim() && 
                             formData.price_monthly !== '' && 
                             parseFloat(formData.price_monthly) >= 0 &&
                             formData.price_annual !== '' && 
                             parseFloat(formData.price_annual) >= 0 &&
                             formData.accounting_code.trim() &&
                             !membershipNameExists

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
          <div className="px-4 py-6 sm:px-0">
            <div className="text-center py-8">
              <div className="text-gray-500">Loading membership...</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Edit Membership Type</h1>
            <p className="mt-1 text-sm text-gray-600">
              Update the membership type details and pricing
            </p>
          </div>

          {/* Form */}
          <div className="bg-white shadow rounded-lg">
            <form onSubmit={handleSubmit} className="space-y-6 p-6">
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
                  onChange={(e) => setFormData(prev => ({ ...prev, allow_monthly: e.target.checked }))}
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
              <div>
                <label htmlFor="accounting_code" className="block text-sm font-medium text-gray-700">
                  Accounting Code
                </label>
                <input
                  type="text"
                  id="accounting_code"
                  value={formData.accounting_code}
                  onChange={(e) => setFormData(prev => ({ ...prev, accounting_code: e.target.value }))}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="Enter Accounting Code (required)"
                  required
                />

              </div>

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
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Accounting Code</dt>
                      <dd className="text-sm text-gray-900">{formData.accounting_code || 'Not set'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Discounts</dt>
                      <dd className="text-sm text-gray-900">{formData.allow_discounts ? 'Allowed' : 'Not allowed'}</dd>
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
                  disabled={updating || !canUpdateMembership}
                  className={`inline-flex justify-center items-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 ${
                    canUpdateMembership && !updating
                      ? 'bg-blue-600 hover:bg-blue-700' 
                      : 'bg-gray-400 cursor-not-allowed'
                  }`}
                >
                  {updating && (
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  )}
                  {updating ? 'Updating Membership...' : canUpdateMembership ? 'Update Membership' : 'Complete Form to Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}