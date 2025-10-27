'use client'

import { useState, useEffect } from 'react'
import { useToast } from '@/contexts/ToastContext'
import Link from 'next/link'
import XeroAccountsSection from '@/components/admin/XeroAccountsSection'
import AccountingCodeInput from '@/components/admin/AccountingCodeInput'

interface SystemAccountingCode {
  id: string // UUID
  code_type: string
  accounting_code: string
  description: string | null
  created_at: string
  updated_at: string
}

interface AccountingCodes {
  donation_received_default: string
  donation_given_default: string
  stripe_bank_account: string
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
    donation_received_default: '',
    donation_given_default: '',
    stripe_bank_account: ''
  })
  const [systemCodes, setSystemCodes] = useState<SystemAccountingCode[]>([])
  const [originalCodes, setOriginalCodes] = useState<AccountingCodes>({
    donation_received_default: '',
    donation_given_default: '',
    stripe_bank_account: ''
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

  // Fetch system codes, discount categories and memberships on component mount
  useEffect(() => {
    fetchSystemCodes()
    fetchDiscountCategories()
    fetchMemberships()
  }, [])

  const fetchSystemCodes = async () => {
    try {
      const response = await fetch('/api/admin/system-accounting-codes')
      if (response.ok) {
        const data = await response.json()
        const systemCodes = data.codes || []
        setSystemCodes(systemCodes)
        
        // Initialize the codes state from system codes
        const codesObj: AccountingCodes = {
          donation_received_default: '',
          donation_given_default: '',
          stripe_bank_account: ''
        }
        
        systemCodes.forEach((code: SystemAccountingCode) => {
          if (code.code_type === 'donation_received_default') {
            codesObj.donation_received_default = code.accounting_code || ''
          } else if (code.code_type === 'donation_given_default') {
            codesObj.donation_given_default = code.accounting_code || ''
          } else if (code.code_type === 'stripe_bank_account') {
            codesObj.stripe_bank_account = code.accounting_code || ''
          }
        })
        
        setCodes(codesObj)
        setOriginalCodes(codesObj) // Store original values for change detection
      } else {
        showError('Failed to fetch system accounting codes')
      }
    } catch (error) {
      console.error('Error fetching system accounting codes:', error)
      showError('Error fetching system accounting codes')
    }
  }

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
          inputs[category.id] = category.accounting_code || ''
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
      [key]: value
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

  // Check if default codes have changed
  const hasDefaultCodesChanges = () => {
    return codes.donation_received_default !== originalCodes.donation_received_default ||
           codes.donation_given_default !== originalCodes.donation_given_default ||
           codes.stripe_bank_account !== originalCodes.stripe_bank_account
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
    // Validate donation codes are not empty
    if (!codes.donation_received_default?.trim()) {
      showError('Please enter a donation received accounting code')
      return
    }
    if (!codes.donation_given_default?.trim()) {
      showError('Please enter a donation given accounting code')
      return
    }
    if (!codes.stripe_bank_account?.trim()) {
      showError('Please enter a Stripe bank account code')
      return
    }

    setUpdating(true)
    try {
      // Prepare updates for system accounting codes
      const updates = [
        {
          code_type: 'donation_received_default',
          accounting_code: codes.donation_received_default.trim()
        },
        {
          code_type: 'donation_given_default',
          accounting_code: codes.donation_given_default.trim()
        },
        {
          code_type: 'stripe_bank_account',
          accounting_code: codes.stripe_bank_account.trim()
        }
      ]

      const response = await fetch('/api/admin/system-accounting-codes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.successCount > 0) {
          showSuccess(`Updated ${data.successCount} system accounting codes successfully`)
          // Update original codes to reflect saved state
          setOriginalCodes({ ...codes })
          // Refresh the system codes to reflect changes
          await fetchSystemCodes()
        } else {
          showError('Failed to update system accounting codes')
        }
      } else {
        showError('Failed to update system accounting codes')
      }
    } catch (error) {
      console.error('Error updating system accounting codes:', error)
      showError('Error updating system accounting codes')
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
            These codes are required to connect to Xero.
          </p>
          
          <div className="grid grid-cols-1 gap-6">
            <AccountingCodeInput
              value={codes.donation_received_default}
              onChange={(value) => handleInputChange('donation_received_default', value)}
              label="Donation Received Default"
              required
              placeholder="Search for accounting code..."
              accountType="REVENUE"
            />
            <AccountingCodeInput
              value={codes.donation_given_default}
              onChange={(value) => handleInputChange('donation_given_default', value)}
              label="Donation Given Default (Financial Assistance)"
              required
              placeholder="Search for accounting code..."
              accountType="EXPENSE"
            />
            <AccountingCodeInput
              value={codes.stripe_bank_account}
              onChange={(value) => handleInputChange('stripe_bank_account', value)}
              label="Stripe Bank Account"
              required
              placeholder="Search for accounting code..."
              accountType="BANK"
            />
          </div>
          
          {/* Save Button for Default Codes */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleUpdateDefaults}
              disabled={updating || !hasDefaultCodesChanges()}
              className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updating ? 'Saving...' : 'Save Changes'}
            </button>
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
            <div className="grid grid-cols-1 gap-6">
              {discountCategories.map((category) => (
                <AccountingCodeInput
                  key={category.id}
                  value={categoryInputs[category.id] || ''}
                  onChange={(value) => handleCategoryInputChange(category.id, value)}
                  label={`${category.name}${category.description ? ` - ${category.description}` : ''}`}
                  required
                  placeholder="Search for accounting code..."
                  accountType="EXPENSE"
                />
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
            <div className="grid grid-cols-1 gap-6">
              {memberships.map((membership) => (
                <AccountingCodeInput
                  key={membership.id}
                  value={membershipInputs[membership.id] || ''}
                  onChange={(value) => handleMembershipInputChange(membership.id, value)}
                  label={`${membership.name}${membership.description ? ` - ${membership.description}` : ''}`}
                  required
                  placeholder="Search for accounting code..."
                  accountType="REVENUE"
                />
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

        {/* Xero Chart of Accounts Section */}
        <XeroAccountsSection />

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