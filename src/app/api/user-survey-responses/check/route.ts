import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const { survey_id } = await request.json()
    
    if (!survey_id) {
      return NextResponse.json(
        { error: 'Survey ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createServerClient()

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