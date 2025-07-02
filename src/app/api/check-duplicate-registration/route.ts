import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const registrationId = searchParams.get('registrationId')
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!registrationId) {
      return NextResponse.json({ error: 'Registration ID required' }, { status: 400 })
    }

    // Check for existing paid registration (exclude processing records)
    const { data: existingRegistration, error } = await supabase
      .from('user_registrations')
      .select('id, payment_status')
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .eq('payment_status', 'paid')
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error checking duplicate registration:', error)
      return NextResponse.json({ error: 'Failed to check registration' }, { status: 500 })
    }

    return NextResponse.json({
      isAlreadyRegistered: !!existingRegistration,
      registrationId: existingRegistration?.id || null
    })
    
  } catch (error) {
    console.error('Error in duplicate registration check API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}