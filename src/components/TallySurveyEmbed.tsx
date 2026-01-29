'use client'

import React, { useEffect, useState } from 'react'

interface TallySurveyEmbedProps {
  surveyId: string                    // e.g., "VLzWBv"
  userEmail: string                   // from users table
  userId: string                      // users.id (UUID)
  fullName: string                    // first_name + ' ' + last_name
  memberNumber?: string               // member_id (e.g., "1002") - optional
  
  // Component behavior
  layout?: 'inline' | 'modal'         // Default: 'inline'
  onComplete?: (responseData: any) => void
  onClose?: () => void
  onError?: (error: string) => void
}

export default function TallySurveyEmbed({
  surveyId,
  userEmail,
  userId,
  fullName,
  memberNumber,
  layout = 'inline',
  onComplete,
  onClose,
  onError
}: TallySurveyEmbedProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [surveyOpened, setSurveyOpened] = useState(false)
  const [surveyCompleted, setSurveyCompleted] = useState(false)
  const [existingSurveyCompleted, setExistingSurveyCompleted] = useState(false)

  // Check if user has already completed this survey
  const checkExistingSurveyCompletion = async () => {
    try {
      const response = await fetch('/api/user-survey-responses/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          survey_id: surveyId
        })
      })
      
      if (response.ok) {
        const { completed } = await response.json()
        if (completed) {
          console.log('User has already completed this survey')
          setExistingSurveyCompleted(true)
          setIsLoading(false)
          onComplete?.(null) // Notify parent that survey is complete
          return true
        }
      }
    } catch (err) {
      console.error('Error checking existing survey completion:', err)
    }
    return false
  }

  // Store survey response in database
  const storeSurveyResponse = async (responseData: any) => {
    try {
      const response = await fetch('/api/user-survey-responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          survey_id: surveyId,
          response_data: responseData
        })
      })
      
      if (!response.ok) {
        console.error('Failed to store survey response:', response.status)
      } else {
        console.log('Survey response stored successfully')
      }
    } catch (err) {
      console.error('Error storing survey response:', err)
    }
  }

  useEffect(() => {
    const loadTallyAndOpenSurvey = async () => {
      // First check if user has already completed the survey
      const alreadyCompleted = await checkExistingSurveyCompletion()
      if (alreadyCompleted) {
        return
      }
      try {
        setIsLoading(true)
        setError(null)

        console.log('Loading Tally script for survey:', surveyId)

        // Check if Tally script is already loaded
        if (typeof window !== 'undefined' && !(window as any).Tally) {
          console.log('Loading Tally embed script...')
          // Dynamically load Tally embed script
          const script = document.createElement('script')
          script.src = 'https://tally.so/widgets/embed.js'
          script.async = true
          script.onload = () => {
            console.log('Tally embed script loaded successfully')
            openSurveyPopup()
          }
          script.onerror = () => {
            const errorMsg = 'Failed to load Tally embed script'
            console.error(errorMsg)
            setError(errorMsg)
            setIsLoading(false)
            onError?.(errorMsg)
          }
          document.body.appendChild(script)
        } else {
          // Script already loaded
          console.log('Tally script already loaded')
          openSurveyPopup()
        }
      } catch (err) {
        console.error('Error in loadTallyAndOpenSurvey:', err)
        const errorMsg = err instanceof Error ? err.message : 'Unknown error loading survey'
        setError(errorMsg)
        setIsLoading(false)
        onError?.(errorMsg)
      }
    }

    const openSurveyPopup = () => {
      console.log('Opening Tally popup for survey ID:', surveyId)
      
      try {
        const hiddenFields = {
          hidden_user_id: userId,
          hidden_email: userEmail,
          hidden_full_name: fullName,
          email: userEmail, // Pre-fill visible email field
          name: fullName,   // Pre-fill visible name field
          ...(memberNumber && { hidden_member_number: memberNumber })
        }

        console.log('Opening popup with hidden fields:', hiddenFields)

        ;(window as any).Tally.openPopup(surveyId, {
          layout: 'modal',
          width: 700,
          autoClose: 2000, // Close 2 seconds after submit
          emoji: {
            text: '🏳️‍🌈',
            animation: 'wave'
          },
          hiddenFields,
          onOpen: () => {
            console.log('Survey popup opened')
            setSurveyOpened(true)
            setIsLoading(false)
          },
          onClose: () => {
            console.log('Survey popup closed')
            setSurveyOpened(false)
            // Call the parent close handler to reset survey state
            onClose?.()
          },
          onSubmit: async (payload: any) => {
            console.log('Survey submitted:', payload)
            setSurveyCompleted(true)
            setSurveyOpened(false)
            
            // Store the response in the database
            await storeSurveyResponse(payload)
            
            onComplete?.(payload)
          }
        })

      } catch (err) {
        console.error('Error opening Tally popup:', err)
        const errorMsg = err instanceof Error ? err.message : 'Failed to open survey'
        setError(errorMsg)
        setIsLoading(false)
        onError?.(errorMsg)
      }
    }

    if (surveyId && userEmail) {
      loadTallyAndOpenSurvey()
    }

    // Cleanup function
    return () => {
      // Close popup if component unmounts
      if (surveyOpened && (window as any).Tally?.closePopup) {
        (window as any).Tally.closePopup(surveyId)
      }
    }
  }, [surveyId, userEmail, userId, fullName, memberNumber, onComplete, onClose, onError])

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
        <div className="flex items-center">
          <svg className="h-5 w-5 text-red-400 mr-2" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <h3 className="text-sm font-medium text-red-800">Survey Error</h3>
        </div>
        <div className="mt-2 text-sm text-red-700">
          {error}
        </div>
        <div className="mt-3">
          <button
            onClick={() => window.location.reload()}
            className="text-sm bg-red-100 hover:bg-red-200 text-red-800 px-3 py-1 rounded border border-red-300"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-6 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-center justify-center">
          <svg className="animate-spin h-5 w-5 text-blue-600 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-sm text-blue-800">Loading survey...</span>
        </div>
      </div>
    )
  }

  // If user already completed the survey, show completion message
  if (existingSurveyCompleted) {
    return (
      <div className="p-6 bg-green-50 border border-green-200 rounded-lg">
        <div className="flex items-center">
          <svg className="h-5 w-5 text-green-400 mr-2" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <h3 className="text-sm font-medium text-green-800">Survey Already Completed</h3>
        </div>
        <div className="mt-2 text-sm text-green-700">
          You have already completed this survey. You can proceed with registration.
        </div>
      </div>
    )
  }

  // Survey just completed in this session
  if (surveyCompleted) {
    return (
      <div className="p-6 bg-green-50 border border-green-200 rounded-lg">
        <div className="flex items-center">
          <svg className="h-5 w-5 text-green-400 mr-2" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <h3 className="text-sm font-medium text-green-800">Survey Completed</h3>
        </div>
        <div className="mt-2 text-sm text-green-700">
          Thank you! You can now proceed with registration.
        </div>

        {/* Debug info (development only) */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mt-4 p-3 bg-gray-100 border rounded text-xs">
            <strong>Debug Info:</strong>
            <div>Survey ID: {surveyId}</div>
            <div>User: {userEmail} ({userId})</div>
            <div>Member Number: {memberNumber || 'N/A'}</div>
          </div>
        )}
      </div>
    )
  }

  // Survey is active (popup open)
  if (surveyOpened) {
    return (
      <div className="p-6 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-center">
          <svg className="h-5 w-5 text-blue-600 mr-2" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
          <h3 className="text-sm font-medium text-blue-800">Survey Active</h3>
        </div>
        <div className="mt-2 text-sm text-blue-700">
          Please complete the survey to continue with registration.
        </div>
      </div>
    )
  }

  // This should not happen - loading should be true if we get here
  return null
}