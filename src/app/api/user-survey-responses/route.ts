import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Simple test endpoint to check authentication
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    return NextResponse.json({
      success: true,
      authenticated: !!user,
      user_id: user?.id || null,
      auth_error: authError?.message || null,
      test: 'Survey auth test endpoint'
    })

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { survey_id, response_data } = await request.json()
    
    console.log('=== SURVEY API DEBUG START ===')
    console.log('Survey API called with:', { survey_id, response_data })
    
    if (!survey_id || !response_data) {
      console.log('❌ Missing required fields:', { survey_id: !!survey_id, response_data: !!response_data })
      return NextResponse.json(
        { error: 'Survey ID and response data are required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    console.log('✅ Supabase client created')

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    console.log('Auth check result:', { 
      user_exists: !!user, 
      user_id: user?.id, 
      user_email: user?.email,
      auth_error: authError?.message 
    })
    
    if (authError || !user) {
      console.log('❌ Authentication failed:', authError)
      return NextResponse.json(
        { error: 'User not authenticated', details: authError?.message },
        { status: 401 }
      )
    }

    console.log('✅ User authenticated:', user.id)
    console.log('Attempting to insert survey response...')

    // Insert the survey response
    const insertData = {
      survey_id,
      user_id: user.id,
      response_data,
      completed_at: new Date().toISOString()
    }
    console.log('Insert data:', insertData)

    const { data, error } = await supabase
      .from('user_survey_responses')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      console.log('❌ Supabase insert error:', error)
      return NextResponse.json(
        { error: 'Failed to store survey response', details: error.message, code: error.code },
        { status: 500 }
      )
    }

    console.log('✅ Survey response stored successfully:', data)
    console.log('=== SURVEY API DEBUG END ===')
    
    return NextResponse.json({ 
      success: true, 
      survey_response_id: data.id 
    })

  } catch (error) {
    console.log('❌ Unexpected error in survey response storage API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}