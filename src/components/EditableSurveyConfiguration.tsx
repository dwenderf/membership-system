'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface EditableSurveyConfigurationProps {
  registrationId: string
  initialConfig: {
    require_survey: boolean
    survey_id: string | null
  }
}

export default function EditableSurveyConfiguration({
  registrationId,
  initialConfig,
}: EditableSurveyConfigurationProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [requireSurvey, setRequireSurvey] = useState(initialConfig.require_survey)
  const [surveyId, setSurveyId] = useState(initialConfig.survey_id || '')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  const handleSave = async () => {
    setError('')

    // Validate survey_id when require_survey is true
    if (requireSurvey && !surveyId.trim()) {
      setError('Survey ID is required when survey is enabled')
      return
    }

    setIsSaving(true)

    try {
      const { error: updateError } = await supabase
        .from('registrations')
        .update({
          require_survey: requireSurvey,
          survey_id: requireSurvey ? surveyId : null,
        })
        .eq('id', registrationId)

      if (updateError) {
        setError(updateError.message)
      } else {
        setIsEditing(false)
        // Refresh the page to show updated data
        window.location.reload()
      }
    } catch (err) {
      setError('Failed to update survey configuration')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setRequireSurvey(initialConfig.require_survey)
    setSurveyId(initialConfig.survey_id || '')
    setError('')
    setIsEditing(false)
  }

  if (!isEditing) {
    return (
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {requireSurvey ? (
            <div className="space-y-1">
              <div className="text-sm text-gray-900">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 mr-2">
                  Required
                </span>
              </div>
              {surveyId && (
                <div className="text-xs text-gray-600 font-mono bg-gray-50 p-2 rounded break-all">
                  {surveyId}
                </div>
              )}
            </div>
          ) : (
            <span className="text-sm text-gray-500">Not required</span>
          )}
        </div>
        <button
          onClick={() => setIsEditing(true)}
          className="ml-3 text-sm text-blue-600 hover:text-blue-500 font-medium"
        >
          Edit
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
          {error}
        </div>
      )}

      <div className="flex items-center">
        <input
          id="require_survey_edit"
          type="checkbox"
          checked={requireSurvey}
          onChange={(e) => {
            setRequireSurvey(e.target.checked)
            // Clear survey_id if unchecked
            if (!e.target.checked) {
              setSurveyId('')
            }
          }}
          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
        />
        <label htmlFor="require_survey_edit" className="ml-2 block text-sm text-gray-900">
          Require survey before payment
        </label>
      </div>

      {requireSurvey && (
        <div>
          <label htmlFor="survey_id_edit" className="block text-xs font-medium text-gray-700 mb-1">
            Survey ID (Formbricks)
          </label>
          <input
            id="survey_id_edit"
            type="text"
            value={surveyId}
            onChange={(e) => setSurveyId(e.target.value)}
            placeholder="e.g., cmkvdmu2804u4ad01o4ve1lj1"
            className="block w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      )}

      <div className="flex justify-end space-x-2">
        <button
          onClick={handleCancel}
          disabled={isSaving}
          className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-3 py-1 text-xs font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
