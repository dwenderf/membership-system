import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { surveyId: string } }
) {
  console.log('🔍 API route called with surveyId:', params?.surveyId)

  try {
    // 🛡️ SECURITY: Check user authentication
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      console.error('❌ Unauthorized access attempt')
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    console.log('✅ Authenticated user:', user.email)

    const { surveyId } = params
    
    if (!surveyId) {
      console.error('❌ No surveyId provided')
      return NextResponse.json(
        { error: 'Survey ID is required' },
        { status: 400 }
      )
    }
    
    if (!process.env.NEXT_PUBLIC_FORMBRICKS_ENV_ID || !process.env.NEXT_PUBLIC_FORMBRICKS_API_HOST) {
      console.error('❌ Missing Formbricks configuration')
      return NextResponse.json(
        { error: 'Formbricks configuration missing' },
        { status: 500 }
      )
    }

    // Use Management API to fetch survey data (requires API key)
    if (!process.env.FORMBRICKS_API_KEY) {
      console.error('❌ FORMBRICKS_API_KEY not found')
      return NextResponse.json(
        { error: 'Formbricks API key not configured' },
        { status: 500 }
      )
    }

    const managementUrl = `${process.env.NEXT_PUBLIC_FORMBRICKS_API_HOST}/api/v1/management/surveys/${surveyId}`
    console.log('🌐 Fetching from Management API:', managementUrl)

    const response = await fetch(managementUrl, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.FORMBRICKS_API_KEY,
      },
    })

    console.log('📡 Formbricks response:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ Failed to fetch survey from Formbricks:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      })
      return NextResponse.json(
        { error: 'Failed to fetch survey data', details: errorText },
        { status: response.status }
      )
    }

    const surveyData = await response.json()
    console.log('✅ Survey data fetched successfully:', { hasData: !!surveyData })
    
    return NextResponse.json(surveyData)
  } catch (error) {
    console.error('💥 Error fetching survey:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}