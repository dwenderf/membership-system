import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    // Verify this is a legitimate cron request
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('🕐 Scheduled Xero keep-alive started')

    // Call the keep-alive endpoint
    const keepAliveResponse = await fetch(`${process.env.NEXTAUTH_URL}/api/xero/keep-alive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const result = await keepAliveResponse.json()

    if (result.success) {
      console.log(`✅ Scheduled Xero keep-alive completed: ${result.message}`)
      return NextResponse.json({
        success: true,
        message: 'Xero keep-alive completed successfully',
        details: result.summary
      })
    } else {
      console.error('❌ Scheduled Xero keep-alive failed:', result.error)
      return NextResponse.json({
        success: false,
        error: result.error
      }, { status: 500 })
    }

  } catch (error) {
    console.error('❌ Scheduled Xero keep-alive error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}