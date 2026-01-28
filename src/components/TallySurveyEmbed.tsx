'use client'

import React, { useEffect, useRef, useState } from 'react'

interface TallySurveyEmbedProps {
  surveyId: string                    // e.g., "VLzWBv"
  userEmail: string                   // from users table
  userId: string                      // users.id (UUID)
  fullName: string                    // first_name + ' ' + last_name
  memberNumber?: string               // member_id (e.g., "1002") - optional
  
  // Component behavior
  layout?: 'inline' | 'modal'         // Default: 'inline'
  onComplete?: (responseData: any) => void
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
  onError
}: TallySurveyEmbedProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [embedElement, setEmbedElement] = useState<HTMLDivElement | null>(null)

  // Build survey URL with user context
  const buildSurveyUrl = () => {
    if (!process.env.NEXT_PUBLIC_TALLY_BASE_URL) {
      throw new Error('NEXT_PUBLIC_TALLY_BASE_URL environment variable not set')
    }

    const params = new URLSearchParams({
      // Pre-filled visible fields
      email: userEmail,
      name: fullName,
      
      // Hidden fields for context and analytics
      hidden_user_id: userId,
      hidden_email: userEmail,
      hidden_full_name: fullName,
      ...(memberNumber && { hidden_member_number: memberNumber })
    })

    const baseUrl = `${process.env.NEXT_PUBLIC_TALLY_BASE_URL}${surveyId}`
    return `${baseUrl}?${params.toString()}`
  }

  // Callback ref to get notified when DOM element is available
  const embedRefCallback = (node: HTMLDivElement | null) => {
    console.log('Embed element callback called with:', !!node)
    setEmbedElement(node)
  }

  // Debug props and state
  console.log('TallySurveyEmbed render:', {
    surveyId,
    userEmail,
    embedElement: !!embedElement,
    isLoading,
    error
  })

  useEffect(() => {
    const loadTallyEmbed = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Validate environment variable first
        if (!process.env.NEXT_PUBLIC_TALLY_BASE_URL) {
          throw new Error('NEXT_PUBLIC_TALLY_BASE_URL environment variable not set')
        }

        // Check if Tally embed script is already loaded
        if (typeof window !== 'undefined' && !(window as any).Tally) {
          console.log('Loading Tally embed script...')
          // Dynamically load Tally embed script
          const script = document.createElement('script')
          script.src = 'https://tally.so/widgets/embed.js'
          script.async = true
          script.onload = () => {
            console.log('Tally embed script loaded successfully')
            // Initialize immediately since we know the element is available
            initializeSurvey()
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
          // Script already loaded, initialize immediately
          console.log('Tally script already loaded')
          initializeSurvey()
        }
      } catch (err) {
        console.error('Error in loadTallyEmbed:', err)
        const errorMsg = err instanceof Error ? err.message : 'Unknown error loading survey'
        setError(errorMsg)
        setIsLoading(false)
        onError?.(errorMsg)
      }
    }

    const initializeSurvey = () => {
      console.log('Initializing survey for ID:', surveyId)
      console.log('Embed element available:', !!embedElement)
      console.log('Tally object available:', !!(window as any).Tally)
      
      if (!embedElement) {
        console.error('Embed element not available')
        setError('Survey container not ready')
        setIsLoading(false)
        return
      }

      try {
        const surveyUrl = buildSurveyUrl()
        console.log('Built survey URL:', surveyUrl)
        
        // Clear any existing attributes first
        embedElement.removeAttribute('data-tally-src')
        embedElement.removeAttribute('data-tally-layout')
        embedElement.removeAttribute('data-tally-width')
        embedElement.removeAttribute('data-tally-emoji-text')
        embedElement.removeAttribute('data-tally-emoji-animation')
        
        // Set up Tally embed attributes
        embedElement.setAttribute('data-tally-src', surveyUrl)
        embedElement.setAttribute('data-tally-layout', layout === 'modal' ? 'modal' : 'standard')
        embedElement.setAttribute('data-tally-width', '100%')
        embedElement.setAttribute('data-tally-emoji-text', '👋')
        embedElement.setAttribute('data-tally-emoji-animation', 'wave')

        console.log('Tally survey initialized with attributes')
        console.log('Element attributes:', {
          'data-tally-src': embedElement.getAttribute('data-tally-src'),
          'data-tally-layout': embedElement.getAttribute('data-tally-layout')
        })
        
        // Force Tally to re-scan the DOM for new widgets
        if ((window as any).Tally && (window as any).Tally.loadEmbeds) {
          (window as any).Tally.loadEmbeds()
          console.log('Called Tally.loadEmbeds()')
        }
        
        // Set loading to false after a short delay to allow Tally to render
        setTimeout(() => {
          setIsLoading(false)
          console.log('Survey loading complete')
        }, 1000)
        
        // Listen for survey completion (if Tally provides events)
        if ((window as any).Tally?.on) {
          (window as any).Tally.on('form_submit', (data: any) => {
            console.log('Survey completed:', data)
            onComplete?.(data)
          })
        }

      } catch (err) {
        console.error('Error initializing survey:', err)
        const errorMsg = err instanceof Error ? err.message : 'Failed to initialize survey'
        setError(errorMsg)
        setIsLoading(false)
        onError?.(errorMsg)
      }
    }

    console.log('useEffect triggered with:', {
      surveyId,
      userEmail,
      embedElement: !!embedElement,
      condition: !!(surveyId && userEmail && embedElement)
    })

    if (surveyId && userEmail && embedElement) {
      console.log('All conditions met, loading Tally embed...')
      loadTallyEmbed()
    } else {
      console.log('Conditions not met:', {
        hasSurveyId: !!surveyId,
        hasUserEmail: !!userEmail,
        hasEmbedElement: !!embedElement
      })
    }

    // Cleanup function
    return () => {
      // Remove event listeners if needed
      if ((window as any).Tally?.off) {
        (window as any).Tally.off('form_submit')
      }
    }
  }, [surveyId, userEmail, userId, fullName, memberNumber, layout, embedElement, onComplete, onError])

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

  return (
    <div className="w-full">
      {/* Tally embed container */}
      <div 
        ref={embedRefCallback}
        className="tally-survey-embed"
        style={{ minHeight: layout === 'inline' ? '400px' : 'auto' }}
      />
      
      {/* Debug info (development only) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mt-4 p-3 bg-gray-100 border rounded text-xs">
          <strong>Debug Info:</strong>
          <div>Survey ID: {surveyId}</div>
          <div>User: {userEmail} ({userId})</div>
          <div>Layout: {layout}</div>
          <div>Member Number: {memberNumber || 'N/A'}</div>
        </div>
      )}
    </div>
  )
}