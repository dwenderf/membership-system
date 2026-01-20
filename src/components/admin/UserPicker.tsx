'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  member_id?: number
}

interface UserPickerProps {
  onSelect: (userId: string, userName: string) => void
  excludeUserIds?: string[]
  label?: string
  placeholder?: string
  disabled?: boolean
}

/**
 * User Picker with Autocomplete
 *
 * Features:
 * - Real-time search by name, email, or member ID
 * - Keyboard navigation support
 * - Debounced search for performance
 * - Visual member ID badges
 * - Excludes already-selected users
 */
export default function UserPicker({
  onSelect,
  excludeUserIds = [],
  label = 'Search User',
  placeholder = 'Search by name, email, or member #...',
  disabled = false
}: UserPickerProps) {
  const [users, setUsers] = useState<User[]>([])
  const [filteredUsers, setFilteredUsers] = useState<User[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch users on mount
  useEffect(() => {
    fetchUsers()
  }, [])

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

  const fetchUsers = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/admin/users?limit=1000')
      if (response.ok) {
        const data = await response.json()
        setUsers(data.users || [])
      }
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Debounced search function
  const debouncedSearch = useCallback(
    (searchTerm: string) => {
      // Clear previous timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }

      // Set new timeout
      debounceTimeoutRef.current = setTimeout(() => {
        const excludeSet = new Set(excludeUserIds)
        const availableUsers = users.filter(u => !excludeSet.has(u.id))

        if (!searchTerm.trim()) {
          setFilteredUsers(availableUsers.slice(0, 10)) // Show first 10 when no search
          return
        }

        // Enforce 2-character minimum to match hint
        if (searchTerm.trim().length < 2) {
          setFilteredUsers([])
          return
        }

        const lowerSearch = searchTerm.toLowerCase()
        const filtered = availableUsers.filter(
          user =>
            user.email.toLowerCase().includes(lowerSearch) ||
            user.first_name?.toLowerCase().includes(lowerSearch) ||
            user.last_name?.toLowerCase().includes(lowerSearch) ||
            (user.member_id && user.member_id.toString().includes(lowerSearch))
        ).slice(0, 10) // Limit to 10 results

        setFilteredUsers(filtered)
        setHighlightedIndex(0)
      }, 150)
    },
    [users, excludeUserIds]
  )

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setSearchTerm(newValue)
    debouncedSearch(newValue)
    setIsOpen(true)
  }

  const handleInputFocus = () => {
    setIsOpen(true)
    // Show first 10 users on focus if no search term
    if (!searchTerm.trim()) {
      const excludeSet = new Set(excludeUserIds)
      const availableUsers = users.filter(u => !excludeSet.has(u.id))
      setFilteredUsers(availableUsers.slice(0, 10))
    }
  }

  const handleSelectUser = (user: User) => {
    const userName = `${user.first_name} ${user.last_name}`.trim()
    onSelect(user.id, userName)
    setSearchTerm('')
    setIsOpen(false)
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
          prev < filteredUsers.length - 1 ? prev + 1 : prev
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filteredUsers[highlightedIndex]) {
          handleSelectUser(filteredUsers[highlightedIndex])
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

  return (
    <div className="relative">
      <label htmlFor="user-picker" className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>

      <div className="relative">
        <input
          ref={inputRef}
          id="user-picker"
          type="text"
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm disabled:opacity-50 disabled:bg-gray-100"
          aria-expanded={isOpen}
          aria-controls="user-picker-listbox"
          aria-activedescendant={isOpen ? `user-option-${highlightedIndex}` : undefined}
          role="combobox"
          autoComplete="off"
        />

        {isLoading && (
          <div className="absolute right-3 top-2.5">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
          </div>
        )}

        {/* Dropdown */}
        {isOpen && filteredUsers.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute z-10 mt-1 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm"
            id="user-picker-listbox"
            role="listbox"
          >
            <ul ref={listRef}>
              {filteredUsers.map((user, index) => {
                const isHighlighted = index === highlightedIndex

                return (
                  <li
                    key={user.id}
                    id={`user-option-${index}`}
                    role="option"
                    aria-selected={isHighlighted}
                    className={`
                      cursor-pointer select-none relative py-2 pl-3 pr-9
                      ${isHighlighted ? 'bg-blue-50 text-blue-900' : 'text-gray-900'}
                      hover:bg-blue-50
                    `}
                    onClick={() => handleSelectUser(user)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {user.first_name} {user.last_name}
                        </span>
                        {user.member_id && (
                          <span className="text-xs bg-green-100 text-green-800 px-1.5 py-0.5 rounded">
                            #{user.member_id}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {user.email}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* No results */}
        {isOpen && filteredUsers.length === 0 && !isLoading && searchTerm.trim().length >= 2 && (
          <div
            ref={dropdownRef}
            className="absolute z-10 mt-1 w-full bg-white shadow-lg rounded-md py-3 text-base ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm"
          >
            <div className="text-center text-gray-500 text-sm">
              No users found
            </div>
          </div>
        )}
      </div>

      <p className="mt-1 text-xs text-gray-500">
        Type at least 2 characters to search
      </p>
    </div>
  )
}
