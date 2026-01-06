import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateICalContent } from '@/lib/calendar-utils'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const alternateRegistrationId = searchParams.get('alternateRegistrationId')
    const alternateSelectionId = searchParams.get('alternateSelectionId')

    if (!alternateRegistrationId || !alternateSelectionId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    const supabase = await createClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch alternate selection to verify access and get game details
    const { data: alternateSelection, error: selectionError } = await supabase
      .from('alternate_selections')
      .select(`
        id,
        user_id,
        alternate_registration:alternate_registrations (
          id,
          game_description,
          game_date,
          registration:registrations (
            name
          )
        )
      `)
      .eq('id', alternateSelectionId)
      .eq('alternate_registration_id', alternateRegistrationId)
      .single()

    if (selectionError || !alternateSelection) {
      return NextResponse.json({ error: 'Alternate selection not found' }, { status: 404 })
    }

    // Verify user has access to this selection
    if (alternateSelection.user_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const gameDate = new Date(alternateSelection.alternate_registration.game_date)
    const gameEndDate = new Date(gameDate.getTime() + 90 * 60 * 1000) // Add 90 minutes

    // Generate iCal content
    const icalContent = generateICalContent(
      alternateSelection.alternate_registration.game_description,
      gameDate.toISOString(),
      gameEndDate.toISOString(),
      `Alternate game for ${alternateSelection.alternate_registration.registration.name}`
    )

    // Return as downloadable .ics file
    return new NextResponse(icalContent, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${alternateSelection.alternate_registration.game_description.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.ics"`,
      },
    })

  } catch (error) {
    console.error('Error generating alternate calendar file:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
