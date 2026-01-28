import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const { survey_id, user_email } = await request.json()
    
    if (!survey_id || !user_email) {
      return NextResponse.json(
        { error: 'Survey ID and user email are required' },
        { status: 400 }
      )
    }

    const supabase = await createServerClient()

    // Check if user has already completed this survey
    const { data: existing, error } = await supabase
      .from('user_survey_responses')
      .select('id')
      .eq('survey_id', survey_id)
      .eq('user_email', user_email)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking survey completion:', error)
      return NextResponse.json(
        { error: 'Failed to check survey completion' },
        { status: 500 }
      )
    }

    const completed = !!existing

    return NextResponse.json({ completed })

  } catch (error) {
    console.error('Error in survey completion check API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}