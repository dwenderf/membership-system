import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

export async function POST(request: NextRequest) {
  try {
    const { survey_id, response_data } = await request.json()
    
    if (!survey_id || !response_data) {
      return NextResponse.json(
        { error: 'Survey ID and response data are required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'User not authenticated' },
        { status: 401 }
      )
    }

    // Insert the survey response (or update if already exists)
    const { data, error } = await supabase
      .from('user_survey_responses')
      .insert({
        survey_id,
        user_id: user.id,
        response_data,
        completed_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      // Check if it's a unique constraint violation (duplicate survey response)
      if (error.code === '23505') {
        // Handle duplicate by updating the existing response
        const { data: updateData, error: updateError } = await supabase
          .from('user_survey_responses')
          .update({
            response_data,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user.id)
          .eq('survey_id', survey_id)
          .select()
          .single()

        if (updateError) {
          logger.logSystem('survey-response-update-error', 'Error updating survey response', { userId: user.id, survey_id, error: updateError.message }, 'error')
          return NextResponse.json(
            { error: 'Failed to update survey response' },
            { status: 500 }
          )
        }

        return NextResponse.json({ 
          success: true, 
          survey_response_id: updateData.id,
          updated: true
        })
      }

      logger.logSystem('survey-response-store-error', 'Error storing survey response', { userId: user.id, survey_id, error: error.message }, 'error')
      return NextResponse.json(
        { error: 'Failed to store survey response' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      success: true, 
      survey_response_id: data.id,
      updated: false
    })

  } catch (error) {
    logger.logSystem('survey-response-storage-unexpected-error', 'Error in survey response storage API', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}