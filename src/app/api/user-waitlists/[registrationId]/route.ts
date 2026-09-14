import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ registrationId: string }> }
) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { registrationId } = await params
    
    if (!registrationId) {
      return NextResponse.json({ error: 'Registration ID required' }, { status: 400 })
    }

    // Get user's waitlist entries for this registration
    const { data: waitlistEntries, error } = await supabase
      .from('waitlists')
      .select('id, registration_category_id, position')
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .is('removed_at', null)
    
    if (error) {
      logger.logPaymentProcessing('user-waitlist-entries-load-failed', 'Error loading waitlist entries', { userId: user.id, registrationId, error: error.message }, 'error')
      return NextResponse.json({ error: 'Failed to load waitlist entries' }, { status: 500 })
    }
    
    // Convert to the format expected by the frontend
    const waitlistMap: Record<string, { position: number, id: string }> = {}
    waitlistEntries?.forEach(entry => {
      if (entry.registration_category_id) {
        waitlistMap[entry.registration_category_id] = {
          position: entry.position,
          id: entry.id
        }
      }
    })
    
    return NextResponse.json({ waitlistEntries: waitlistMap })
    
  } catch (error) {
    logger.logPaymentProcessing('user-waitlists-error', 'Error in user waitlists API', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}