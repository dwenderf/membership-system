import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { surveyId: string } }
) {
  try {
    const { surveyId } = params
    
    if (!process.env.NEXT_PUBLIC_FORMBRICKS_ENV_ID || !process.env.NEXT_PUBLIC_FORMBRICKS_API_HOST) {
      return NextResponse.json(
        { error: 'Formbricks configuration missing' },
        { status: 500 }
      )
    }

    // Fetch survey data from Formbricks API server-side
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_FORMBRICKS_API_HOST}/api/v1/client/${process.env.NEXT_PUBLIC_FORMBRICKS_ENV_ID}/surveys/${surveyId}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      console.error('Failed to fetch survey from Formbricks:', response.status, response.statusText)
      return NextResponse.json(
        { error: 'Failed to fetch survey data' },
        { status: response.status }
      )
    }

    const surveyData = await response.json()
    
    return NextResponse.json(surveyData)
  } catch (error) {
    console.error('Error fetching survey:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}