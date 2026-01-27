'use client'

import { useEffect, useState } from 'react'

// Extend window interface for Formbricks surveys
declare global {
  interface Window {
    formbricksSurveys?: {
      renderSurveyModal: (props: {
        survey: any
        appUrl: string
        environmentId: string
        userId: string
        attributes?: Record<string, any>
        onClose?: () => void
        onFinished?: (responses: Record<string, any>) => void
      }) => void
    }
  }
}

interface RegistrationSurveyProps {
  surveyId: string
  userEmail: string
  registrationName: string
  onComplete: (responses: Record<string, any>) => void
  onSkip?: () => void
}

export default function RegistrationSurvey({
  surveyId,
  userEmail,
  registrationName,
  onComplete,
  onSkip
}: RegistrationSurveyProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Load Formbricks SDK using the current v4+ API
    const loadFormbricks = async () => {
      try {
        // Check if Formbricks is already available
        if (typeof window !== 'undefined' && (window as any).formbricks) {
          console.log('Formbricks already available')
          showSurvey()
          return
        }

        // Dynamically import Formbricks
        const { default: formbricks } = await import('@formbricks/js')

        // Check for required environment variables
        if (!process.env.NEXT_PUBLIC_FORMBRICKS_ENV_ID || 
            !process.env.NEXT_PUBLIC_FORMBRICKS_API_HOST) {
          console.error('Missing Formbricks config:', {
            hasEnvId: !!process.env.NEXT_PUBLIC_FORMBRICKS_ENV_ID,
            hasApiHost: !!process.env.NEXT_PUBLIC_FORMBRICKS_API_HOST
          })
          throw new Error('Formbricks configuration missing')
        }

        // Initialize with the current v4+ API using setup
        await formbricks.setup({
          environmentId: process.env.NEXT_PUBLIC_FORMBRICKS_ENV_ID,
          appUrl: process.env.NEXT_PUBLIC_FORMBRICKS_API_HOST
        })

        // Set user information
        formbricks.setUserId(userEmail)
        formbricks.setAttribute('registrationName', registrationName)

        console.log('Formbricks initialized successfully')
        showSurvey()

      } catch (err) {
        console.error('Failed to load Formbricks:', err)
        
        // Check if it's a content blocker issue
        if (err instanceof Error && (err.message.includes('fetch') || err.message.includes('blocked'))) {
          setError('Survey blocked by ad blocker or privacy extension. Please disable it for this site.')
        } else if (err instanceof Error && err.message.includes('CORS')) {
          setError('Survey configuration error. Please check your Formbricks setup.')
        } else {
          setError('Failed to load survey. Please try again.')
        }
        setIsLoading(false)
      }
    }

    const showSurvey = async () => {
      try {
        const { default: formbricks } = await import('@formbricks/js')
        
        // Fetch the specific survey data by ID
        console.log('Fetching survey data for ID:', surveyId)
        
        // Note: We need to use Formbricks' client API to fetch the survey
        // and then render it directly using the surveys package
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_FORMBRICKS_API_HOST}/api/v1/client/${process.env.NEXT_PUBLIC_FORMBRICKS_ENV_ID}/surveys/${surveyId}`,
          {
            headers: {
              'Content-Type': 'application/json',
            },
          }
        )

        if (!response.ok) {
          throw new Error('Failed to fetch survey data')
        }

        const surveyData = await response.json()
        
        // Load the surveys rendering package
        const surveysScript = document.createElement('script')
        surveysScript.src = `${process.env.NEXT_PUBLIC_FORMBRICKS_API_HOST}/js/surveys.umd.cjs`
        surveysScript.onload = () => {
          // Once surveys package is loaded, render the survey
          if ((window as any).formbricksSurveys) {
            (window as any).formbricksSurveys.renderSurveyModal({
              survey: surveyData.data,
              appUrl: process.env.NEXT_PUBLIC_FORMBRICKS_API_HOST,
              environmentId: process.env.NEXT_PUBLIC_FORMBRICKS_ENV_ID,
              userId: userEmail,
              attributes: {
                registrationName: registrationName
              },
              onClose: () => {
                if (onSkip) onSkip()
              },
              onFinished: (responses: Record<string, any>) => {
                console.log('Survey completed:', responses)
                onComplete(responses)
              }
            })
            
            console.log('Survey displayed successfully')
            setIsLoading(false)
          } else {
            throw new Error('Surveys package failed to load')
          }
        }
        surveysScript.onerror = () => {
          throw new Error('Failed to load surveys package')
        }
        
        document.head.appendChild(surveysScript)

      } catch (err) {
        console.error('Failed to display survey:', err)
        setError('Failed to display survey.')
        setIsLoading(false)
      }
    }

    loadFormbricks()
  }, [surveyId, userEmail, registrationName])

  const handleComplete = (responses: Record<string, any>) => {
    onComplete(responses)
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
        <div className="flex items-start">
          <svg className="h-5 w-5 text-red-600 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-red-800">Survey Error</h3>
            <p className="text-sm text-red-700 mt-1">{error}</p>
            {onSkip && (
              <button
                onClick={onSkip}
                className="mt-3 text-sm text-red-800 underline hover:text-red-900"
              >
                Skip survey and continue
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-blue-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-sm text-gray-600">Loading survey...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="registration-survey-container">
      {/* Formbricks survey will appear as an overlay/popup automatically */}
      <div className="p-6 text-center">
        <div className="mb-4">
          <svg className="mx-auto h-12 w-12 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Survey Loading</h3>
        <p className="text-sm text-gray-600">
          The survey should appear in a moment. Please complete it to proceed with your registration.
        </p>
        <p className="text-xs text-gray-500 mt-4">
          If the survey doesn't appear, please refresh the page and try again.
        </p>
      </div>
    </div>
  )
}
