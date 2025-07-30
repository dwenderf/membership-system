import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const eventType = searchParams.get('type')
    const limit = parseInt(searchParams.get('limit') || '10')
    
    const supabase = createAdminClient()
    
    let query = supabase
      .from('system_events')
      .select('*')
      .order('completed_at', { ascending: false })
      .limit(limit)
    
    if (eventType) {
      query = query.eq('event_type', eventType)
    }
    
    const { data: events, error } = await query
    
    if (error) {
      return NextResponse.json({
        success: false,
        error: error.message
      }, { status: 500 })
    }
    
    return NextResponse.json({
      success: true,
      events: events || []
    })
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    return NextResponse.json({
      success: false,
      error: errorMessage
    }, { status: 500 })
  }
} 