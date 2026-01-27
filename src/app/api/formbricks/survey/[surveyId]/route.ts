import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { surveyId: string } }
) {
  console.log('🔍 API route called with surveyId:', params?.surveyId)
  console.log('🔍 Environment check:', {
    hasEnvId: !!process.env.NEXT_PUBLIC_FORMBRICKS_ENV_ID,
    hasApiHost: !!process.env.NEXT_PUBLIC_FORMBRICKS_API_HOST,
    envId: process.env.NEXT_PUBLIC_FORMBRICKS_ENV_ID?.substring(0, 8) + '...',
    apiHost: process.env.NEXT_PUBLIC_FORMBRICKS_API_HOST
  })

  try {
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

    const formbricksUrl = `${process.env.NEXT_PUBLIC_FORMBRICKS_API_HOST}/api/v1/client/${process.env.NEXT_PUBLIC_FORMBRICKS_ENV_ID}/surveys/${surveyId}`
    console.log('🌐 Fetching from Formbricks:', formbricksUrl)

    // Fetch survey data from Formbricks API server-side
    const response = await fetch(formbricksUrl, {
      headers: {
        'Content-Type': 'application/json',
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