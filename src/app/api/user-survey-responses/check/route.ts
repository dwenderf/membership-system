import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

export async function POST(request: NextRequest) {
  try {
    const { survey_id } = await request.json()
    
    if (!survey_id) {
      return NextResponse.json(
        { error: 'Survey ID is required' },
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

    // Check if user has already completed this survey
    const { data: existing, error } = await supabase
      .from('user_survey_responses')
      .select('id')
      .eq('survey_id', survey_id)
      .eq('user_id', user.id)
      .single()

    if (error && error.code !== 'PGRST116') {
      logger.logSystem('survey-completion-check-error', 'Error checking survey completion', { userId: user.id, survey_id, error: error.message }, 'error')
      return NextResponse.json(
        { error: 'Failed to check survey completion' },
        { status: 500 }
      )
    }

    const completed = !!existing

    return NextResponse.json({ completed })

  } catch (error) {
    logger.logSystem('survey-completion-check-unexpected-error', 'Error in survey completion check API', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}