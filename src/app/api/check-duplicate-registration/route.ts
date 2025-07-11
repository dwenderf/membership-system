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

    // Check for existing registrations (paid or non-expired processing)
    const { data: existingRegistrations, error } = await supabase
      .from('user_registrations')
      .select('id, payment_status, reservation_expires_at')
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)

    if (error) {
      console.error('Error checking duplicate registration:', error)
      return NextResponse.json({ error: 'Failed to check registration' }, { status: 500 })
    }

    // Check each registration status
    let paidRegistration = null
    let activeProcessingRegistration = null
    
    if (existingRegistrations && existingRegistrations.length > 0) {
      for (const reg of existingRegistrations) {
        if (reg.payment_status === 'paid') {
          paidRegistration = reg
          break // Paid takes priority
        }
        if (reg.payment_status === 'awaiting_payment') {
          if (reg.reservation_expires_at) {
            const expiresAt = new Date(reg.reservation_expires_at)
            if (expiresAt > new Date()) {
              activeProcessingRegistration = reg
            }
          } else {
            // Old processing record without expiration - treat as expired
            console.log(`Found old processing record without expiration: ${reg.id}`)
          }
        }
      }
    }

    return NextResponse.json({
      isAlreadyRegistered: !!paidRegistration,
      hasActiveReservation: !!activeProcessingRegistration,
      status: paidRegistration ? 'paid' : (activeProcessingRegistration ? 'awaiting_payment' : 'none'),
      registrationId: paidRegistration?.id || activeProcessingRegistration?.id || null,
      expiresAt: activeProcessingRegistration?.reservation_expires_at || null
    })
    
  } catch (error) {
    console.error('Error in duplicate registration check API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}