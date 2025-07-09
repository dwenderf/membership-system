'use client'

import { useState, useEffect } from 'react'
import { useToast } from '@/contexts/ToastContext'
import Link from 'next/link'

interface AccountingCodes {
  donation_default: string
  registration_default: string | null
}

interface DiscountCategory {
  id: string
  name: string
  accounting_code: string
  description: string | null
  is_active: boolean
}

interface Membership {
  id: string
  name: string
  description: string | null
  accounting_code: string | null
  price_monthly: number
  price_annual: number
  allow_discounts: boolean
}

export default function AccountingCodesPage() {
  const [codes, setCodes] = useState<AccountingCodes>({
    donation_default: '',
    registration_default: null
  })
  
  const [discountCategories, setDiscountCategories] = useState<DiscountCategory[]>([])
  const [categoryInputs, setCategoryInputs] = useState<Record<string, string>>({})
  const [originalCategoryInputs, setOriginalCategoryInputs] = useState<Record<string, string>>({})
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [membershipInputs, setMembershipInputs] = useState<Record<string, string>>({})
  const [originalMembershipInputs, setOriginalMembershipInputs] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [updating, setUpdating] = useState(false)
  const { showError, showSuccess, showWarning } = useToast()

  // Fetch discount categories and memberships on component mount
  useEffect(() => {
    fetchDiscountCategories()
    fetchMemberships()
  }, [])

  const fetchDiscountCategories = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/discount-categories')
      if (response.ok) {
        const data = await response.json()
        const categories = data.categories || []
        setDiscountCategories(categories)
        
        // Initialize category inputs with current accounting codes
        const inputs: Record<string, string> = {}
        categories.forEach((category: DiscountCategory) => {
          inputs[category.id] = category.accounting_code
        })
        setCategoryInputs(inputs)
        setOriginalCategoryInputs(inputs)
      } else {
        showError('Failed to fetch discount categories')
      }
    } catch (error) {
      console.error('Error fetching discount categories:', error)
      showError('Error fetching discount categories')
    } finally {
      setLoading(false)
    }
  }

  const fetchMemberships = async () => {
    try {
      const response = await fetch('/api/admin/memberships')
      if (response.ok) {
        const data = await response.json()
        const memberships = data.memberships || []
        setMemberships(memberships)
        
        // Initialize membership inputs with current accounting codes
        const inputs: Record<string, string> = {}
        memberships.forEach((membership: Membership) => {
          inputs[membership.id] = membership.accounting_code || ''
        })
        setMembershipInputs(inputs)
        setOriginalMembershipInputs(inputs)
      } else {
        showError('Failed to fetch memberships')
      }
    } catch (error) {
      console.error('Error fetching memberships:', error)
      showError('Error fetching memberships')
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (key: keyof AccountingCodes, value: string) => {
    setCodes(prev => ({
      ...prev,
      [key]: value === '' ? null : value
    }))
  }

  const handleCategoryInputChange = (categoryId: string, value: string) => {
    setCategoryInputs(prev => ({
      ...prev,
      [categoryId]: value
    }))
  }

  const handleMembershipInputChange = (membershipId: string, value: string) => {
    setMembershipInputs(prev => ({
      ...prev,
      [membershipId]: value
    }))
  }

  // Check if any category has changed
  const hasChanges = () => {
    return Object.keys(categoryInputs).some(categoryId => 
      categoryInputs[categoryId] !== originalCategoryInputs[categoryId]
    )
  }

  // Get changed categories
  const getChangedCategories = () => {
    return Object.keys(categoryInputs).filter(categoryId => 
      categoryInputs[categoryId] !== originalCategoryInputs[categoryId]
    )
  }

  // Check if any membership has changed
  const hasMembershipChanges = () => {
    return Object.keys(membershipInputs).some(membershipId => 
      membershipInputs[membershipId] !== originalMembershipInputs[membershipId]
    )
  }

  // Get changed memberships
  const getChangedMemberships = () => {
    return Object.keys(membershipInputs).filter(membershipId => 
      membershipInputs[membershipId] !== originalMembershipInputs[membershipId]
    )
  }

  const handleUpdateDefaults = async () => {
    // Validate donation default is not empty
    if (!codes.donation_default?.trim()) {
      showError('Please enter a donation accounting code')
      return
    }

    setUpdating(true)
    try {
      const response = await fetch('/api/admin/accounting-codes/update-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(codes)
      })

      if (response.ok) {
        const data = await response.json()
        showSuccess(`Updated ${data.updated} records successfully`)
      } else {
        showError('Failed to update accounting codes')
      }
    } catch (error) {
      console.error('Error updating accounting codes:', error)
      showError('Error updating accounting codes')
    } finally {
      setUpdating(false)
    }
  }

  const handleBulkUpdate = async (category: 'registration_categories') => {
    const code = codes.registration_default
    
    if (!code) {
      showError('Please enter a default code first')
      return
    }

    setUpdating(true)
    try {
      const response = await fetch('/api/admin/accounting-codes/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, accounting_code: code })
      })

      if (response.ok) {
        const data = await response.json()
        showSuccess(`Updated ${data.updated} ${category.replace('_', ' ')} records`)
      } else {
        showError(`Failed to update ${category}`)
      }
    } catch (error) {
      console.error(`Error updating ${category}:`, error)
      showError(`Error updating ${category}`)
    } finally {
      setUpdating(false)
    }
  }

  const handleSaveDiscountCategories = async () => {
    const changedCategories = getChangedCategories()
    if (changedCategories.length === 0) {
      return
    }

    setUpdating(true)
    try {
      // Prepare updates array and validate all have values
      const updates = []
      const emptyCategories = []
      
      for (const categoryId of changedCategories) {
        const accountingCode = categoryInputs[categoryId]?.trim()
        if (!accountingCode) {
          const categoryName = discountCategories.find(cat => cat.id === categoryId)?.name || 'Unknown'
          emptyCategories.push(categoryName)
        } else {
          updates.push({
            category_id: categoryId,
            accounting_code: accountingCode
          })
        }
      }

      if (emptyCategories.length > 0) {
        showError(`Please enter accounting codes for: ${emptyCategories.join(', ')}`)
        return
      }

      if (updates.length === 0) {
        return
      }

      const response = await fetch('/api/admin/accounting-codes/update-discount-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates })
      })

      if (response.ok) {
        const data = await response.json()
        const { successCount, errorCount, results } = data

        // Update local state for successful updates
        results.forEach((result: any) => {
          if (result.success) {
            setDiscountCategories(prev => prev.map(cat => 
              cat.id === result.category_id 
                ? { ...cat, accounting_code: categoryInputs[result.category_id] } 
                : cat
            ))
          }
        })

        // Update original inputs to reflect saved state for successful updates
        const newOriginalInputs = { ...originalCategoryInputs }
        results.forEach((result: any) => {
          if (result.success) {
            newOriginalInputs[result.category_id] = categoryInputs[result.category_id]
          }
        })
        setOriginalCategoryInputs(newOriginalInputs)

        // Show single toast message
        if (successCount > 0 && errorCount === 0) {
          if (successCount === 1) {
            showSuccess('Accounting code updated successfully')
          } else {
            showSuccess(`${successCount} accounting codes updated successfully`)
          }
        } else if (successCount > 0 && errorCount > 0) {
          showWarning(`${successCount} updated successfully, ${errorCount} failed`)
        } else {
          showError('Failed to update accounting codes')
        }
      } else {
        showError('Failed to update accounting codes')
      }
    } catch (error) {
      console.error('Error saving discount categories:', error)
      showError('Error saving changes')
    } finally {
      setUpdating(false)
    }
  }

  const handleSaveMemberships = async () => {
    const changedMemberships = getChangedMemberships()
    if (changedMemberships.length === 0) {
      return
    }

    setUpdating(true)
    try {
      // Prepare updates array and validate all have values
      const updates = []
      const emptyMemberships = []
      
      for (const membershipId of changedMemberships) {
        const accountingCode = membershipInputs[membershipId]?.trim()
        if (!accountingCode) {
          const membershipName = memberships.find(m => m.id === membershipId)?.name || 'Unknown'
          emptyMemberships.push(membershipName)
        } else {
          updates.push({
            membership_id: membershipId,
            accounting_code: accountingCode
          })
        }
      }

      if (emptyMemberships.length > 0) {
        showError(`Please enter accounting codes for: ${emptyMemberships.join(', ')}`)
        return
      }

      if (updates.length === 0) {
        return
      }

      const response = await fetch('/api/admin/accounting-codes/update-memberships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates })
      })

      if (response.ok) {
        const data = await response.json()
        const { successCount, errorCount, results } = data

        // Update local state for successful updates
        results.forEach((result: any) => {
          if (result.success) {
            setMemberships(prev => prev.map(membership => 
              membership.id === result.membership_id 
                ? { ...membership, accounting_code: membershipInputs[result.membership_id] || null } 
                : membership
            ))
          }
        })

        // Update original inputs to reflect saved state for successful updates
        const newOriginalInputs = { ...originalMembershipInputs }
        results.forEach((result: any) => {
          if (result.success) {
            newOriginalInputs[result.membership_id] = membershipInputs[result.membership_id]
          }
        })
        setOriginalMembershipInputs(newOriginalInputs)

        // Show single toast message
        if (successCount > 0 && errorCount === 0) {
          if (successCount === 1) {
            showSuccess('Membership accounting code updated successfully')
          } else {
            showSuccess(`${successCount} membership accounting codes updated successfully`)
          }
        } else if (successCount > 0 && errorCount > 0) {
          showWarning(`${successCount} updated successfully, ${errorCount} failed`)
        } else {
          showError('Failed to update membership accounting codes')
        }
      } else {
        showError('Failed to update membership accounting codes')
      }
    } catch (error) {
      console.error('Error saving memberships:', error)
      showError('Error saving changes')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Accounting Code Management</h1>
      
      <div className="space-y-6">
        {/* Default Codes Section */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Default Account Codes</h2>
          <p className="text-sm text-gray-600 mb-4">
            These codes are used when specific items don't have their own accounting codes set.
          </p>
          
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Donation Default
              </label>
              <input
                type="text"
                value={codes.donation_default}
                onChange={(e) => handleInputChange('donation_default', e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="Enter Accounting Code (required)"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Registration Default
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={codes.registration_default || ''}
                  onChange={(e) => handleInputChange('registration_default', e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  placeholder="Leave empty to require individual codes"
                />
                <button
                  onClick={() => handleBulkUpdate('registration_categories')}
                  disabled={updating || !codes.registration_default}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                >
                  Apply to All
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                If empty, each registration category must have its own code
              </p>
            </div>
          </div>
        </div>

        {/* Discount Accounting Codes */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Discount Accounting Codes</h2>
          <p className="text-sm text-gray-600 mb-4">
            Account codes for different discount categories. Changes update the discount category immediately.
          </p>
          
          {loading ? (
            <div className="text-center py-4">
              <div className="text-gray-500">Loading discount categories...</div>
            </div>
          ) : discountCategories.length === 0 ? (
            <div className="text-center py-4">
              <div className="text-gray-500">No discount categories found</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {discountCategories.map((category) => (
                <div key={category.id}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {category.name}
                    {category.description && (
                      <span className="text-gray-500 font-normal"> - {category.description}</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={categoryInputs[category.id] || ''}
                    onChange={(e) => handleCategoryInputChange(category.id, e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    placeholder={category.accounting_code || 'Enter Accounting Code (required)'}
                  />
                </div>
              ))}
            </div>
          )}
          
          {/* Save Button */}
          {discountCategories.length > 0 && (
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleSaveDiscountCategories}
                disabled={updating || !hasChanges()}
                className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {updating ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>

        {/* Membership Accounting Codes */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Membership Accounting Codes</h2>
          <p className="text-sm text-gray-600 mb-4">
            Account codes for individual membership types. Changes update the membership immediately.
          </p>
          
          {loading ? (
            <div className="text-center py-4">
              <div className="text-gray-500">Loading memberships...</div>
            </div>
          ) : memberships.length === 0 ? (
            <div className="text-center py-4">
              <div className="text-gray-500">No memberships found</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {memberships.map((membership) => (
                <div key={membership.id}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {membership.name}
                    {membership.description && (
                      <span className="text-gray-500 font-normal"> - {membership.description}</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={membershipInputs[membership.id] || ''}
                    onChange={(e) => handleMembershipInputChange(membership.id, e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    placeholder={membership.accounting_code || 'Enter Accounting Code (required)'}
                  />
                </div>
              ))}
            </div>
          )}
          
          {/* Save Button */}
          {memberships.length > 0 && (
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleSaveMemberships}
                disabled={updating || !hasMembershipChanges()}
                className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {updating ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>

        {/* Information */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-medium text-blue-900 mb-2">How This Works</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• <strong>Default codes</strong> are used by Xero integration when specific items don't have their own codes</li>
            <li>• <strong>Discount categories</strong> and <strong>memberships</strong> update immediately and affect all codes in that category</li>
            <li>• <strong>Apply to All</strong> button only affects records that currently have no accounting code set</li>
            <li>• <strong>Individual items</strong> can still have their own specific codes that override defaults</li>
          </ul>
        </div>

        {/* Return to Admin Link */}
        <div className="mt-6">
          <Link 
            href="/admin"
            className="text-blue-600 hover:text-blue-500 text-sm font-medium"
          >
            ← Back to Admin Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}