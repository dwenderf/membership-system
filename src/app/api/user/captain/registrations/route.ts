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
      .select('registration_id')
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

    // Fetch all registrations (we'll filter by date later)
    const { data: registrations, error: registrationsError } = await supabase
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

    if (registrationsError) {
      console.error('Error fetching registrations:', registrationsError)
      return NextResponse.json(
        { error: 'Failed to fetch registrations' },
        { status: 500 }
      )
    }

    // For each registration, get category breakdown and alternate count
    const enrichedRegistrations = await Promise.all(
      (registrations || []).map(async (registration) => {
        // Get all categories for this registration
        const { data: categories } = await supabase
          .from('registration_categories')
          .select(`
            id,
            custom_name,
            max_capacity,
            categories (
              name
            )
          `)
          .eq('registration_id', registration.id)

        // Get all user registrations with their categories (excluding refunded)
        const { data: userRegistrations } = await supabase
          .from('user_registrations')
          .select('registration_category_id, payment_status')
          .eq('registration_id', registration.id)
          .neq('payment_status', 'refunded')

        // Build category breakdown with counts
        const categoryBreakdown = (categories || []).map(cat => {
          const category = Array.isArray(cat.categories) ? cat.categories[0] : cat.categories
          const count = userRegistrations?.filter(ur => ur.registration_category_id === cat.id).length || 0

          return {
            id: cat.id,
            name: category?.name || cat.custom_name || 'Unknown Category',
            count: count,
            max_capacity: cat.max_capacity
          }
        })

        // Calculate total count
        const totalCount = categoryBreakdown.reduce((sum, cat) => sum + cat.count, 0)

        // Get unique alternates count if alternates are enabled (all registered alternates)
        let alternateCount = 0
        if (registration.allow_alternates) {
          const { data: userAlternateRegistrations } = await supabase
            .from('user_alternate_registrations')
            .select('user_id')
            .eq('registration_id', registration.id)

          // Count unique user_ids
          const uniqueUserIds = new Set(userAlternateRegistrations?.map(r => r.user_id) || [])
          alternateCount = uniqueUserIds.size
        }

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
          total_count: totalCount,
          category_breakdown: categoryBreakdown,
          alternates_enabled: registration.allow_alternates || false,
          alternates_count: alternateCount
        }
      })
    )

    // Filter by date if not including past
    let filteredRegistrations = enrichedRegistrations
    if (!includePast) {
      // Extract date portion (YYYY-MM-DD) for consistent comparison
      const todayDateString = new Date().toISOString().split('T')[0]
      filteredRegistrations = enrichedRegistrations.filter(registration => {
        // Check registration end_date first
        if (registration.end_date) {
          const endDateString = registration.end_date.split('T')[0]
          return endDateString >= todayDateString
        }
        // Fall back to season end_date
        if (registration.season_end_date) {
          const seasonEndDateString = registration.season_end_date.split('T')[0]
          return seasonEndDateString >= todayDateString
        }
        // If no dates, include it
        return true
      })
    }

    // Sort: current/future first (by season start date), then past
    filteredRegistrations.sort((a, b) => {
      const aEnd = a.end_date || a.season_end_date
      const bEnd = b.end_date || b.season_end_date

      if (!aEnd && !bEnd) return 0
      if (!aEnd) return -1
      if (!bEnd) return 1

      // Sort by end date descending (most recent first)
      return new Date(bEnd).getTime() - new Date(aEnd).getTime()
    })

    return NextResponse.json({ data: filteredRegistrations })
  } catch (error) {
    console.error('Error in captain registrations API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
