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

        // Get all user registrations with their categories and financial data (excluding refunded).
        // Join registration_categories so we can group by name, not UUID — ensures counts are
        // correct even if category records were ever recreated with new UUIDs.
        const { data: userRegistrations } = await supabase
          .from('user_registrations')
          .select(`
            registration_category_id,
            payment_status,
            amount_paid,
            registration_fee,
            registration_categories (
              custom_name,
              categories (
                name
              )
            )
          `)
          .eq('registration_id', registration.id)
          .neq('payment_status', 'refunded')

        // Helper to resolve category name from joined record
        const resolveName = (regCat: { custom_name?: string | null; categories?: { name?: string } | { name?: string }[] | null } | null | undefined): string => {
          if (!regCat) return 'Unknown Category'
          const cat = Array.isArray(regCat.categories) ? regCat.categories[0] : regCat.categories
          return cat?.name || regCat.custom_name || 'Unknown Category'
        }

        // Accumulate counts and financial totals by category name
        const catNameCountMap = new Map<string, number>()
        let rosterGross = 0
        let rosterNet = 0
        userRegistrations?.forEach(ur => {
          const regCat = Array.isArray(ur.registration_categories) ? ur.registration_categories[0] : ur.registration_categories
          const catName = resolveName(regCat)
          catNameCountMap.set(catName, (catNameCountMap.get(catName) || 0) + 1)
          // Only include paid/processing in financial totals
          if (['paid', 'processing', 'awaiting_payment'].includes(ur.payment_status)) {
            rosterGross += ur.registration_fee || 0
            rosterNet += ur.amount_paid || 0
          }
        })

        // Build category breakdown using name-based counts
        const categoryBreakdown = (categories || []).map(cat => {
          const category = Array.isArray(cat.categories) ? cat.categories[0] : cat.categories
          const catName = category?.name || cat.custom_name || 'Unknown Category'
          const count = catNameCountMap.get(catName) || 0

          return {
            id: cat.id,
            name: catName,
            count: count,
            max_capacity: cat.max_capacity
          }
        })

        // Total count = all non-refunded members regardless of category match
        const totalCount = Array.from(catNameCountMap.values()).reduce((sum, c) => sum + c, 0)

        // Get unique alternates count and financial data if alternates are enabled
        let alternateCount = 0
        let altGross = 0
        let altNet = 0
        if (registration.allow_alternates) {
          const { data: userAlternateRegistrations } = await supabase
            .from('user_alternate_registrations')
            .select('user_id')
            .eq('registration_id', registration.id)

          const uniqueUserIds = new Set(userAlternateRegistrations?.map(r => r.user_id) || [])
          alternateCount = uniqueUserIds.size

          // Fetch alternate selection financial data
          const { data: altSelections } = await supabase
            .from('alternate_selections')
            .select(`
              amount_charged,
              alternate_registrations!inner (
                registration_id
              ),
              payments (
                total_amount,
                final_amount,
                status
              )
            `)
            .eq('alternate_registrations.registration_id', registration.id)

          altSelections?.forEach(sel => {
            const payment = Array.isArray(sel.payments) ? sel.payments[0] : sel.payments
            if (payment && !['completed', 'pending', 'processing'].includes(payment.status)) return
            altGross += payment?.total_amount || sel.amount_charged
            altNet += payment?.final_amount || sel.amount_charged
          })
        }

        const financialSummary = {
          roster_gross: rosterGross,
          roster_discounts: rosterGross - rosterNet,
          roster_net: rosterNet,
          alt_gross: altGross,
          alt_discounts: altGross - altNet,
          alt_net: altNet,
          total_net: rosterNet + altNet
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
          alternates_count: alternateCount,
          financial_summary: financialSummary
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
