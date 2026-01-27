'use client'

import { useEffect, useState } from 'react'

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
    // Load Formbricks SDK
    const loadFormbricks = async () => {
      try {
        // Check if Formbricks is already loaded
        if (typeof window !== 'undefined' && (window as any).formbricks) {
          console.log('Formbricks already loaded')
          initializeSurvey()
          return
        }

        // Dynamically import Formbricks
        const formbricks = await import('@formbricks/js')

        // Initialize Formbricks
        const envId = process.env.NEXT_PUBLIC_FORMBRICKS_ENV_ID || process.env.NEXT_PUBLIC_FORMBRICKS_ENVIRONMENT_ID
        const apiHost = process.env.NEXT_PUBLIC_FORMBRICKS_API_HOST

        if (envId && apiHost) {
          await formbricks.default.init({
            environmentId: envId,
            apiHost: apiHost,
            userId: userEmail,
          })

          initializeSurvey()
        } else {
          throw new Error('Formbricks configuration missing')
        }
      } catch (err) {
        console.error('Failed to load Formbricks:', err)
        setError('Failed to load survey. Please try again.')
        setIsLoading(false)
      }
    }

    const initializeSurvey = async () => {
      try {
        const formbricks = (window as any).formbricks

        if (!formbricks) {
          throw new Error('Formbricks not initialized')
        }

        // Track survey display
        formbricks.track('registration_survey_shown', {
          registrationName,
          surveyId
        })

        // Listen for survey completion
        formbricks.registerRouteChange()

        setIsLoading(false)
      } catch (err) {
        console.error('Failed to initialize survey:', err)
        setError('Failed to initialize survey.')
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
      {/* Formbricks survey will render here */}
      <div id="formbricks-survey" data-survey-id={surveyId}>
        {/* Survey loads here via Formbricks SDK */}
      </div>

      {/* Placeholder instructions */}
      <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
        <p className="text-sm text-blue-800">
          <strong>Complete the survey above</strong> to proceed with your registration.
        </p>
      </div>
    </div>
  )
}
