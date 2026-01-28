import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const { survey_id, user_email, user_id, response_data } = await request.json()
    
    if (!survey_id || !user_email || !response_data) {
      return NextResponse.json(
        { error: 'Survey ID, user email, and response data are required' },
        { status: 400 }
      )
    }

    const supabase = await createServerClient()

    // Insert the survey response
    const { data, error } = await supabase
      .from('user_survey_responses')
      .insert({
        survey_id,
        user_email,
        user_id: user_id || null,
        response_data,
        completed_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error('Error storing survey response:', error)
      return NextResponse.json(
        { error: 'Failed to store survey response' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      success: true, 
      survey_response_id: data.id 
    })

  } catch (error) {
    console.error('Error in survey response storage API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}