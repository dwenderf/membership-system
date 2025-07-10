'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function XeroConnectPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accountingCodesValid, setAccountingCodesValid] = useState<boolean | null>(null)
  const [accountingCodesError, setAccountingCodesError] = useState('')
  const router = useRouter()

  // Check for OAuth callback results in URL params and validate accounting codes
  useEffect(() => {
    const validateAndSetup = async () => {
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

      // Then check for OAuth callback results
      const urlParams = new URLSearchParams(window.location.search)
      const xeroError = urlParams.get('xero_error')
      const xeroSuccess = urlParams.get('xero_success')
      
      if (xeroError) {
        setError(getErrorMessage(xeroError))
      } else if (xeroSuccess) {
        // Success - redirect to Xero management page
        router.push('/admin/accounting/xero?connected=true')
      }
    }

    validateAndSetup()
  }, [router])

  const handleConnect = async () => {
    // Check accounting codes validation first
    if (accountingCodesValid !== true) {
      setError('All required accounting codes must be configured before connecting to Xero. Please set up the accounting codes first.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Call the auth endpoint to get the OAuth URL
      const response = await fetch('/api/xero/auth', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to initiate Xero connection')
      }

      const { consentUrl } = await response.json()
      
      if (consentUrl) {
        // Redirect to Xero OAuth consent page
        window.location.href = consentUrl
      } else {
        throw new Error('No consent URL received')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to Xero')
      setLoading(false)
    }
  }

  const getErrorMessage = (errorCode: string): string => {
    switch (errorCode) {
      case 'access_denied':
        return 'Access was denied. Please try again and accept the permissions.'
      case 'no_code':
        return 'No authorization code received from Xero. Please try again.'
      case 'token_exchange_failed':
        return 'Failed to exchange authorization code for tokens. Please try again.'
      case 'no_tenants':
        return 'No Xero organizations found. Please ensure you have access to at least one Xero organization.'
      case 'token_storage_failed':
        return 'Failed to store Xero tokens. Please check your database connection.'
      case 'callback_failed':
        return 'OAuth callback failed. Please try again.'
      default:
        return `Connection failed: ${errorCode}. Please try again.`
    }
  }

  return (
    <div className="p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Connect to Xero</h1>
          <p className="mt-2 text-sm text-gray-600">
            Connect your Xero organization to enable automatic invoice and payment syncing
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center">
              <svg className="h-5 w-5 text-red-400 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-red-800">Connection Error</h3>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          </div>
        )}

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

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 mb-4">
              <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
            
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Ready to connect to Xero
            </h3>
            
            <p className="text-sm text-gray-600 mb-6">
              You'll be redirected to Xero to authorize the connection. Make sure you have admin access to your Xero organization.
            </p>

            <div className="space-y-4">
              <button
                onClick={handleConnect}
                disabled={loading || accountingCodesValid !== true}
                className={`inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                  accountingCodesValid === true && !loading
                    ? 'bg-blue-600 hover:bg-blue-700' 
                    : 'bg-gray-400'
                }`}
              >
                {loading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Connecting...
                  </>
                ) : accountingCodesValid === false ? (
                  'Configure Accounting Codes First'
                ) : (
                  'Connect to Xero'
                )}
              </button>
              
              <div className="text-xs text-gray-500">
                <p>By connecting, you agree to allow this application to:</p>
                <ul className="mt-2 space-y-1">
                  <li>• Read and create invoices</li>
                  <li>• Read and create contacts</li>
                  <li>• Record payments</li>
                  <li>• Access organization settings</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 bg-gray-50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-900 mb-2">Before connecting, ensure:</h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• You have admin access to your Xero organization</li>
            <li>• Your accounting codes are configured in the <Link href="/admin/accounting-codes" className="text-blue-600 hover:text-blue-500">accounting codes page</Link></li>
            <li>• Your Xero chart of accounts is set up correctly</li>
          </ul>
        </div>

        {/* Navigation */}
        <div className="mt-6 flex justify-between">
          <Link 
            href="/admin/accounting/xero"
            className="text-blue-600 hover:text-blue-500 text-sm font-medium"
          >
            ← Back to Xero Integration
          </Link>
          
          <Link 
            href="/admin/accounting"
            className="text-blue-600 hover:text-blue-500 text-sm font-medium"
          >
            Accounting Overview
          </Link>
        </div>
      </div>
    </div>
  )
}