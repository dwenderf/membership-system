import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message, data } = body
    
    // Log to server console with a clear prefix
    console.log(`🔍 [DEBUG]: ${message}`, data ? JSON.stringify(data) : '')
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('🔍 [DEBUG] Error:', error)
    return NextResponse.json({ error: 'Debug log failed' }, { status: 500 })
  }
}