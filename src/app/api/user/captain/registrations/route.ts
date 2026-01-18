import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get includePast query parameter (default: false)
    const { searchParams } = new URL(request.url)
    const includePast = searchParams.get('includePast') === 'true'

    // Get all registrations where user is a captain
    const { data: captainships, error: captainshipsError } = await supabase
      .from('registration_captains')
      .select('registration_id, email_notifications')
      .eq('user_id', user.id)

    if (captainshipsError) {
      console.error('Error fetching captain assignments:', captainshipsError)
      return NextResponse.json(
        { error: 'Failed to fetch captain assignments' },
        { status: 500 }
      )
    }

    if (!captainships || captainships.length === 0) {
      return NextResponse.json({ data: [] })
    }

    const registrationIds = captainships.map(c => c.registration_id)

    // Build query for registrations with aggregated data
    let registrationsQuery = supabase
      .from('registrations')
      .select(`
        id,
        name,
        type,
        season_id,
        allow_alternates,
        start_date,
        end_date,
        seasons!inner (
          id,
          name,
          start_date,
          end_date
        )
      `)
      .in('id', registrationIds)

    // If not including past, filter by season/registration end date
    if (!includePast) {
      const today = new Date().toISOString()
      registrationsQuery = registrationsQuery.or(
        `end_date.gte.${today},and(end_date.is.null,seasons.end_date.gte.${today})`
      )
    }

    const { data: registrations, error: registrationsError } = await registrationsQuery

    if (registrationsError) {
      console.error('Error fetching registrations:', registrationsError)
      return NextResponse.json(
        { error: 'Failed to fetch registrations' },
        { status: 500 }
      )
    }

    // For each registration, get member count and alternate count
    const enrichedRegistrations = await Promise.all(
      (registrations || []).map(async (registration) => {
        // Get member count (excluding refunded)
        const { count: memberCount } = await supabase
          .from('user_registrations')
          .select('*', { count: 'exact', head: true })
          .eq('registration_id', registration.id)
          .neq('payment_status', 'refunded')

        // Get alternate count if alternates are enabled
        let alternateCount = 0
        if (registration.allow_alternates) {
          const { count } = await supabase
            .from('user_alternate_registrations')
            .select('*', { count: 'exact', head: true })
            .eq('registration_id', registration.id)

          alternateCount = count || 0
        }

        // Get email notification status for this captain
        const captainship = captainships.find(c => c.registration_id === registration.id)

        return {
          id: registration.id,
          name: registration.name,
          type: registration.type,
          season_id: registration.season_id,
          season_name: registration.seasons?.name || 'Unknown Season',
          season_start_date: registration.seasons?.start_date || null,
          season_end_date: registration.seasons?.end_date || null,
          start_date: registration.start_date,
          end_date: registration.end_date,
          member_count: memberCount || 0,
          alternates_enabled: registration.allow_alternates || false,
          alternates_count: alternateCount,
          email_notifications: captainship?.email_notifications || false,
        }
      })
    )

    // Sort: current/future first (by season start date), then past
    enrichedRegistrations.sort((a, b) => {
      const aEnd = a.end_date || a.season_end_date
      const bEnd = b.end_date || b.season_end_date

      if (!aEnd && !bEnd) return 0
      if (!aEnd) return -1
      if (!bEnd) return 1

      // Sort by end date descending (most recent first)
      return new Date(bEnd).getTime() - new Date(aEnd).getTime()
    })

    return NextResponse.json({ data: enrichedRegistrations })
  } catch (error) {
    console.error('Error in captain registrations API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
