'use client'

import { useState, useEffect } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface AccountingCodes {
  membership_default: string
  donation_default: string
  registration_default: string | null
  discount_scholarship_default: string
  discount_board_default: string
  discount_captains_default: string
  discount_volunteers_default: string
}

export default function AccountingCodesPage() {
  const [codes, setCodes] = useState<AccountingCodes>({
    membership_default: '411',
    donation_default: '410.1',
    registration_default: null,
    discount_scholarship_default: '710.12',
    discount_board_default: '401.1',
    discount_captains_default: '401.3',
    discount_volunteers_default: '401.2'
  })
  
  const [loading, setLoading] = useState(false)
  const [updating, setUpdating] = useState(false)
  const { showToast } = useToast()

  const handleInputChange = (key: keyof AccountingCodes, value: string) => {
    setCodes(prev => ({
      ...prev,
      [key]: value === '' ? null : value
    }))
  }

  const handleUpdateDefaults = async () => {
    setUpdating(true)
    try {
      const response = await fetch('/api/admin/accounting-codes/update-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(codes)
      })

      if (response.ok) {
        const data = await response.json()
        showToast(`Updated ${data.updated} records successfully`, 'success')
      } else {
        showToast('Failed to update accounting codes', 'error')
      }
    } catch (error) {
      console.error('Error updating accounting codes:', error)
      showToast('Error updating accounting codes', 'error')
    } finally {
      setUpdating(false)
    }
  }

  const handleBulkUpdate = async (category: 'memberships' | 'registration_categories') => {
    const code = category === 'memberships' ? codes.membership_default : codes.registration_default
    
    if (!code) {
      showToast('Please enter a default code first', 'error')
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
        showToast(`Updated ${data.updated} ${category.replace('_', ' ')} records`, 'success')
      } else {
        showToast(`Failed to update ${category}`, 'error')
      }
    } catch (error) {
      console.error(`Error updating ${category}:`, error)
      showToast(`Error updating ${category}`, 'error')
    } finally {
      setUpdating(false)
    }
  }

  const handleUpdateDiscountCategory = async (categoryName: string, accountingCode: string) => {
    setUpdating(true)
    try {
      const response = await fetch('/api/admin/accounting-codes/update-discount-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_name: categoryName, accounting_code: accountingCode })
      })

      if (response.ok) {
        showToast(`Updated ${categoryName} accounting code`, 'success')
      } else {
        showToast(`Failed to update ${categoryName}`, 'error')
      }
    } catch (error) {
      console.error(`Error updating ${categoryName}:`, error)
      showToast(`Error updating ${categoryName}`, 'error')
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
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Membership Default
              </label>
              <input
                type="text"
                value={codes.membership_default}
                onChange={(e) => handleInputChange('membership_default', e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="411"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Donation Default
              </label>
              <input
                type="text"
                value={codes.donation_default}
                onChange={(e) => handleInputChange('donation_default', e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="410.1"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Registration Default
              </label>
              <input
                type="text"
                value={codes.registration_default || ''}
                onChange={(e) => handleInputChange('registration_default', e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="Leave empty to require individual codes"
              />
              <p className="text-xs text-gray-500 mt-1">
                If empty, each registration category must have its own code
              </p>
            </div>
          </div>
        </div>

        {/* Discount Category Codes */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Discount Category Codes</h2>
          <p className="text-sm text-gray-600 mb-4">
            Account codes for different discount categories. Changes update the discount category immediately.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Scholarship Fund
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={codes.discount_scholarship_default}
                  onChange={(e) => handleInputChange('discount_scholarship_default', e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  placeholder="710.12"
                />
                <button
                  onClick={() => handleUpdateDiscountCategory('Scholarship Fund', codes.discount_scholarship_default)}
                  disabled={updating}
                  className="bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  Update
                </button>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Board Member
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={codes.discount_board_default}
                  onChange={(e) => handleInputChange('discount_board_default', e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  placeholder="401.1"
                />
                <button
                  onClick={() => handleUpdateDiscountCategory('Board Member', codes.discount_board_default)}
                  disabled={updating}
                  className="bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  Update
                </button>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Captain
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={codes.discount_captains_default}
                  onChange={(e) => handleInputChange('discount_captains_default', e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  placeholder="401.3"
                />
                <button
                  onClick={() => handleUpdateDiscountCategory('Captain', codes.discount_captains_default)}
                  disabled={updating}
                  className="bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  Update
                </button>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Volunteer
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={codes.discount_volunteers_default}
                  onChange={(e) => handleInputChange('discount_volunteers_default', e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  placeholder="401.2"
                />
                <button
                  onClick={() => handleUpdateDiscountCategory('Volunteer', codes.discount_volunteers_default)}
                  disabled={updating}
                  className="bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  Update
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bulk Update Actions */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Bulk Update Operations</h2>
          <p className="text-sm text-gray-600 mb-4">
            Apply default codes to existing records that don't have accounting codes set.
          </p>
          
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-medium">Update All Memberships</h3>
                <p className="text-sm text-gray-600">
                  Set accounting code to "{codes.membership_default}" for all memberships without codes
                </p>
              </div>
              <button
                onClick={() => handleBulkUpdate('memberships')}
                disabled={updating || !codes.membership_default}
                className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                Update Memberships
              </button>
            </div>
            
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-medium">Update All Registration Categories</h3>
                <p className="text-sm text-gray-600">
                  {codes.registration_default ? 
                    `Set accounting code to "${codes.registration_default}" for categories without codes` :
                    'No default set - registration categories require individual codes'
                  }
                </p>
              </div>
              <button
                onClick={() => handleBulkUpdate('registration_categories')}
                disabled={updating || !codes.registration_default}
                className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                Update Categories
              </button>
            </div>
          </div>
        </div>

        {/* Information */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-medium text-blue-900 mb-2">How This Works</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• <strong>Default codes</strong> are used by Xero integration when specific items don't have their own codes</li>
            <li>• <strong>Discount categories</strong> update immediately and affect all codes in that category</li>
            <li>• <strong>Bulk updates</strong> only affect records that currently have no accounting code set</li>
            <li>• <strong>Individual items</strong> can still have their own specific codes that override defaults</li>
          </ul>
        </div>
      </div>
    </div>
  )
}