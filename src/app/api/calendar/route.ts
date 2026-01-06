import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateICalContent } from '@/lib/calendar-utils'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const registrationId = searchParams.get('registrationId')
    const userRegistrationId = searchParams.get('userRegistrationId')

    if (!registrationId) {
      return NextResponse.json({ error: 'Registration ID required' }, { status: 400 })
    }

    const supabase = await createClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch registration details
    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('id, name, type, start_date, end_date')
      .eq('id', registrationId)
      .single()

    if (regError || !registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    // Verify user has access to this registration
    if (userRegistrationId) {
      const { data: userReg, error: userRegError } = await supabase
        .from('user_registrations')
        .select('id')
        .eq('id', userRegistrationId)
        .eq('user_id', user.id)
        .eq('registration_id', registrationId)
        .single()

      if (userRegError || !userReg) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    // Check if this registration has dates (events/scrimmages only)
    if (!registration.start_date || !registration.end_date) {
      return NextResponse.json({
        error: 'Calendar download only available for events and scrimmages with dates'
      }, { status: 400 })
    }

    // Generate iCal content
    const icalContent = generateICalContent(
      registration.name,
      registration.start_date,
      registration.end_date,
      `${registration.type.charAt(0).toUpperCase() + registration.type.slice(1)} registration`
    )

    // Return as downloadable .ics file
    return new NextResponse(icalContent, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${registration.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.ics"`,
      },
    })

  } catch (error) {
    console.error('Error generating calendar file:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
