'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface EditableAlternateConfigurationProps {
  registrationId: string
  initialConfig: {
    allow_alternates: boolean
    alternate_price: number | null
    alternate_accounting_code: string | null
  }
}

export default function EditableAlternateConfiguration({
  registrationId,
  initialConfig
}: EditableAlternateConfigurationProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [config, setConfig] = useState({
    allow_alternates: initialConfig.allow_alternates,
    alternate_price: initialConfig.alternate_price ? (initialConfig.alternate_price / 100).toString() : '',
    alternate_accounting_code: initialConfig.alternate_accounting_code || ''
  })

  const supabase = createClient()

  const handleSave = async () => {
    setLoading(true)
    setError('')

    try {
      const response = await fetch(`/api/admin/registrations/${registrationId}/alternates`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          allow_alternates: config.allow_alternates,
          alternate_price: config.allow_alternates ? parseFloat(config.alternate_price) : null,
          alternate_accounting_code: config.allow_alternates ? config.alternate_accounting_code : null
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update alternate configuration')
      }

      setIsEditing(false)
      // Refresh the page to show updated data
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    setConfig({
      allow_alternates: initialConfig.allow_alternates,
      alternate_price: initialConfig.alternate_price ? (initialConfig.alternate_price / 100).toString() : '',
      alternate_accounting_code: initialConfig.alternate_accounting_code || ''
    })
    setError('')
    setIsEditing(false)
  }

  const canSave = !config.allow_alternates || (
    config.alternate_price.trim() && 
    parseFloat(config.alternate_price) > 0 &&
    config.alternate_accounting_code.trim()
  )

  if (!isEditing) {
    return (
      <div className="group">
        <div className="flex items-center justify-between">
          <div>
            {config.allow_alternates ? (
              <div className="space-y-1">
                <span className="text-green-600">Enabled</span>
                {initialConfig.alternate_price && (
                  <div className="text-xs text-gray-600">
                    Price: ${(initialConfig.alternate_price / 100).toFixed(2)}
                  </div>
                )}
                {initialConfig.alternate_accounting_code && (
                  <div className="text-xs text-gray-600">
                    Code: {initialConfig.alternate_accounting_code}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-red-600">Disabled</span>
            )}
          </div>
          <button
            onClick={() => setIsEditing(true)}
            className="opacity-0 group-hover:opacity-100 ml-2 text-blue-600 hover:text-blue-500 text-sm"
          >
            Edit
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-red-600 text-sm">{error}</div>
      )}
      
      {/* Allow Alternates Toggle */}
      <div className="flex items-center">
        <input
          id="allow_alternates"
          type="checkbox"
          checked={config.allow_alternates}
          onChange={(e) => setConfig(prev => ({ 
            ...prev, 
            allow_alternates: e.target.checked,
            // Clear fields if disabling
            alternate_price: e.target.checked ? prev.alternate_price : '',
            alternate_accounting_code: e.target.checked ? prev.alternate_accounting_code : ''
          }))}
          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
        />
        <label htmlFor="allow_alternates" className="ml-2 block text-sm text-gray-900">
          Enable alternates
        </label>
      </div>

      {/* Alternate Configuration Fields */}
      {config.allow_alternates && (
        <div className="space-y-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
          {/* Alternate Price */}
          <div>
            <label htmlFor="alternate_price" className="block text-xs font-medium text-gray-700">
              Price (USD)
            </label>
            <div className="mt-1 relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                <span className="text-gray-500 text-sm">$</span>
              </div>
              <input
                type="number"
                id="alternate_price"
                value={config.alternate_price}
                onChange={(e) => setConfig(prev => ({ ...prev, alternate_price: e.target.value }))}
                className="block w-full pl-6 pr-3 py-1 text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder="0.00"
                step="0.01"
                min="0"
                required
              />
            </div>
          </div>

          {/* Alternate Accounting Code */}
          <div>
            <label htmlFor="alternate_accounting_code" className="block text-xs font-medium text-gray-700">
              Accounting Code
            </label>
            <input
              type="text"
              id="alternate_accounting_code"
              value={config.alternate_accounting_code}
              onChange={(e) => setConfig(prev => ({ ...prev, alternate_accounting_code: e.target.value }))}
              className="mt-1 block w-full py-1 text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., ALT001"
              required
            />
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex space-x-2">
        <button
          onClick={handleSave}
          disabled={loading || !canSave}
          className={`px-3 py-1 text-sm font-medium rounded-md ${
            canSave && !loading
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          {loading ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={handleCancel}
          disabled={loading}
          className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}