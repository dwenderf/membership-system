'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface XeroAccount {
  code: string
  name: string
  type: string
  description?: string
  inUse: boolean
}

interface AccountingCodeInputProps {
  value: string
  onChange: (value: string) => void
  label?: string
  required?: boolean
  error?: string
  placeholder?: string
  className?: string
  suggestedAccountType?: string // Suggested account type (shows warning if different, but allows all types)
}

/**
 * Intelligent Accounting Code Input with Autocomplete
 *
 * Features:
 * - Real-time validation against Xero chart of accounts
 * - Autocomplete dropdown with intelligent sorting (frequently used first)
 * - Keyboard navigation support
 * - Suggested type filtering (shows suggested type first, all others when searching)
 * - Search by code or name
 * - Visual indicators for codes already in use
 * - Warning for mismatched account types (but still allows selection)
 * - ARIA accessibility
 */
export default function AccountingCodeInput({
  value,
  onChange,
  label = 'Accounting Code',
  required = false,
  error,
  placeholder = 'Search by code or name...',
  className = '',
  suggestedAccountType
}: AccountingCodeInputProps) {
  const [accounts, setAccounts] = useState<XeroAccount[]>([])
  const [filteredAccounts, setFilteredAccounts] = useState<XeroAccount[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [typeWarning, setTypeWarning] = useState<string | null>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [frequentlyUsed, setFrequentlyUsed] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Fetch accounts on mount
  useEffect(() => {
    fetchAccounts()
  }, [])

  // Validate on value change
  useEffect(() => {
    if (value) {
      validateAccountCode(value)
    } else {
      setValidationError(null)
    }
  }, [value])

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !inputRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const highlightedElement = listRef.current.children[highlightedIndex] as HTMLElement
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }, [highlightedIndex, isOpen])

  const fetchAccounts = async () => {
    setIsLoading(true)
    try {
      // Fetch ALL accounts (no type filtering)
      const response = await fetch('/api/xero/accounts')
      if (response.ok) {
        const data = await response.json()
        setAccounts(data.accounts || [])
        setFrequentlyUsed(data.frequentlyUsed || [])
        // Initial display shows suggested type first if specified
        if (suggestedAccountType) {
          const suggested = (data.accounts || []).filter((a: XeroAccount) => a.type === suggestedAccountType)
          const others = (data.accounts || []).filter((a: XeroAccount) => a.type !== suggestedAccountType)
          setFilteredAccounts([...suggested, ...others])
        } else {
          setFilteredAccounts(data.accounts || [])
        }
      }
    } catch (error) {
      console.error('Failed to fetch accounts:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const validateAccountCode = async (code: string) => {
    if (!code) {
      setValidationError(null)
      setTypeWarning(null)
      return
    }

    try {
      const response = await fetch(`/api/xero/validate-account-code?code=${encodeURIComponent(code)}`)
      if (response.ok) {
        const data = await response.json()
        if (!data.valid) {
          setValidationError(data.error || 'Invalid accounting code')
          setTypeWarning(null)
        } else {
          setValidationError(null)

          // Check if account type matches suggested type
          if (suggestedAccountType && data.account && data.account.type !== suggestedAccountType) {
            const typeLabel = suggestedAccountType === 'REVENUE' ? 'revenue' :
                             suggestedAccountType === 'EXPENSE' ? 'expense' :
                             suggestedAccountType === 'BANK' ? 'bank' : suggestedAccountType.toLowerCase()
            setTypeWarning(`This is a ${data.account.type} account. ${typeLabel.toUpperCase()} is typically used for this field.`)
          } else {
            setTypeWarning(null)
          }
        }
      }
    } catch (error) {
      console.error('Validation error:', error)
    }
  }

  // Debounced search function
  const debouncedSearch = useCallback(
    (() => {
      let timeoutId: NodeJS.Timeout
      return (searchTerm: string) => {
        clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
          if (!searchTerm.trim()) {
            // When empty, show suggested type first if specified
            if (suggestedAccountType) {
              const suggested = accounts.filter(a => a.type === suggestedAccountType)
              const others = accounts.filter(a => a.type !== suggestedAccountType)
              setFilteredAccounts([...suggested, ...others])
            } else {
              setFilteredAccounts(accounts)
            }
            return
          }

          // When searching, search ALL accounts regardless of type
          const lowerSearch = searchTerm.toLowerCase()
          const filtered = accounts.filter(
            account =>
              account.code.toLowerCase().includes(lowerSearch) ||
              account.name.toLowerCase().includes(lowerSearch)
          )
          setFilteredAccounts(filtered)
          setHighlightedIndex(0)
        }, 150)
      }
    })(),
    [accounts, suggestedAccountType]
  )

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setSearchTerm(newValue)
    onChange(newValue)
    debouncedSearch(newValue)
    setIsOpen(true)
  }

  const handleInputFocus = () => {
    setIsOpen(true)
    // Show suggested type first if specified
    if (suggestedAccountType && !searchTerm.trim()) {
      const suggested = accounts.filter(a => a.type === suggestedAccountType)
      const others = accounts.filter(a => a.type !== suggestedAccountType)
      setFilteredAccounts([...suggested, ...others])
    } else {
      setFilteredAccounts(accounts)
    }
  }

  const handleSelectAccount = (account: XeroAccount) => {
    onChange(account.code)
    setIsOpen(false)
    setValidationError(null)
    setSearchTerm('')

    // Check for type mismatch warning
    if (suggestedAccountType && account.type !== suggestedAccountType) {
      const typeLabel = suggestedAccountType === 'REVENUE' ? 'revenue' :
                       suggestedAccountType === 'EXPENSE' ? 'expense' :
                       suggestedAccountType === 'BANK' ? 'bank' : suggestedAccountType.toLowerCase()
      setTypeWarning(`This is a ${account.type} account. ${typeLabel.toUpperCase()} is typically used for this field.`)
    } else {
      setTypeWarning(null)
    }

    inputRef.current?.blur()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true)
        e.preventDefault()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex(prev =>
          prev < filteredAccounts.length - 1 ? prev + 1 : prev
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filteredAccounts[highlightedIndex]) {
          handleSelectAccount(filteredAccounts[highlightedIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        break
      case 'Tab':
        setIsOpen(false)
        break
    }
  }

  const displayError = error || validationError

  return (
    <div className={`relative ${className}`}>
      <label htmlFor="accounting-code" className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>

      <div className="mt-1 relative">
        <input
          ref={inputRef}
          id="accounting-code"
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          required={required}
          className={`
            block w-full rounded-md shadow-sm sm:text-sm
            ${displayError
              ? 'border-red-300 text-red-900 placeholder-red-300 focus:ring-red-500 focus:border-red-500'
              : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
            }
          `}
          aria-invalid={!!displayError}
          aria-describedby={displayError ? 'accounting-code-error' : undefined}
          aria-expanded={isOpen}
          aria-controls="accounting-code-listbox"
          aria-activedescendant={isOpen ? `account-option-${highlightedIndex}` : undefined}
          role="combobox"
          autoComplete="off"
        />

        {isLoading && (
          <div className="absolute right-3 top-2.5">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
          </div>
        )}

        {/* Dropdown */}
        {isOpen && filteredAccounts.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute z-10 mt-1 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm"
            id="accounting-code-listbox"
            role="listbox"
          >
            <ul ref={listRef}>
              {filteredAccounts.map((account, index) => {
                const isFrequent = frequentlyUsed.includes(account.code)
                const isHighlighted = index === highlightedIndex

                return (
                  <li
                    key={account.code}
                    id={`account-option-${index}`}
                    role="option"
                    aria-selected={isHighlighted}
                    className={`
                      cursor-pointer select-none relative py-2 pl-3 pr-9
                      ${isHighlighted ? 'bg-blue-50 text-blue-900' : 'text-gray-900'}
                      hover:bg-blue-50
                    `}
                    onClick={() => handleSelectAccount(account)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{account.code}</span>
                          {isFrequent && (
                            <span className="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">
                              Frequently Used
                            </span>
                          )}
                          {account.inUse && (
                            <span className="text-xs bg-green-100 text-green-800 px-1.5 py-0.5 rounded">
                              In Use
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-500 truncate">
                          {account.name}
                        </div>
                        {account.type && (
                          <div className="text-xs text-gray-400">
                            {account.type}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* No results */}
        {isOpen && filteredAccounts.length === 0 && !isLoading && (
          <div
            ref={dropdownRef}
            className="absolute z-10 mt-1 w-full bg-white shadow-lg rounded-md py-3 text-base ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm"
          >
            <div className="text-center text-gray-500 text-sm">
              No accounts found
            </div>
          </div>
        )}
      </div>

      {/* Error message */}
      {displayError && (
        <p className="mt-2 text-sm text-red-600" id="accounting-code-error">
          {displayError}
        </p>
      )}

      {/* Type mismatch warning */}
      {!displayError && typeWarning && (
        <p className="mt-2 text-sm text-yellow-600 flex items-start">
          <svg className="w-4 h-4 mr-1 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {typeWarning}
        </p>
      )}

      {/* Help text */}
      {!displayError && !typeWarning && (
        <p className="mt-1 text-xs text-gray-500">
          Start typing to search for an accounting code
        </p>
      )}
    </div>
  )
}
