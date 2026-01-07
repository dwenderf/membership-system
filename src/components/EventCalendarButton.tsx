'use client'

import { useState } from 'react'
import { generateICalContent, generateGoogleCalendarUrl, downloadICalFile, generateCalendarFilename } from '@/lib/calendar-utils'
import { formatEventDateTime } from '@/lib/date-utils'

interface EventCalendarButtonProps {
  eventName: string
  startDate: string // UTC ISO string
  endDate: string // UTC ISO string
  description?: string
  location?: string
  className?: string
}

export default function EventCalendarButton({
  eventName,
  startDate,
  endDate,
  description,
  location,
  className = ''
}: EventCalendarButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  const handleDownloadICal = () => {
    const content = generateICalContent(eventName, startDate, endDate, description, location)
    const filename = generateCalendarFilename(eventName)
    downloadICalFile(content, filename)
    setIsOpen(false)
  }

  const handleAddToGoogleCalendar = () => {
    const url = generateGoogleCalendarUrl(eventName, startDate, endDate, description, location)
    window.open(url, '_blank')
    setIsOpen(false)
  }

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full mt-3 p-4 bg-blue-50 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors text-left"
      >
        <div className="text-center">
          <p className="text-lg font-semibold text-blue-900">
            {formatEventDateTime(startDate)}
          </p>
          <div className="flex items-center justify-center mt-2 text-sm text-blue-700">
            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Add to Calendar
          </div>
        </div>
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown menu - positioned relative to button */}
          <div className="absolute left-1/2 transform -translate-x-1/2 z-20 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5">
            <div className="py-1" role="menu">
              <button
                onClick={handleAddToGoogleCalendar}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 flex items-center"
                role="menuitem"
              >
                <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.5 14.5v-9l6 4.5-6 4.5z" fill="#4285F4"/>
                </svg>
                Google Calendar
              </button>

              <button
                onClick={handleDownloadICal}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 flex items-center"
                role="menuitem"
              >
                <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Download .ics file
                <span className="ml-auto text-xs text-gray-500">iCal</span>
              </button>

              <div className="border-t border-gray-100 my-1"></div>

              <div className="px-4 py-2 text-xs text-gray-500">
                Works with Apple Calendar, Outlook, and other calendar apps
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
