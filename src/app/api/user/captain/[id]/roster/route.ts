import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id: registrationId } = await params

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is a captain of this registration
    const { data: captainship, error: captainError } = await supabase
      .from('registration_captains')
      .select('id')
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .single()

    if (captainError || !captainship) {
      return NextResponse.json(
        { error: 'You are not a captain of this registration' },
        { status: 403 }
      )
    }

    // Captain is verified - use admin client to bypass RLS for data queries
    const adminSupabase = createAdminClient()

    // Get registration data with user details
    const { data: registrationData, error: registrationError } = await adminSupabase
      .from('user_registrations')
      .select(`
        *,
        users!inner (
          id,
          email,
          first_name,
          last_name,
          member_id,
          is_lgbtq,
          is_goalie,
          phone
        ),
        registrations!inner (
          id,
          name,
          type,
          seasons (
            name
          )
        ),
        registration_categories (
          id,
          custom_name,
          categories (
            name
          )
        )
      `)
      .eq('registration_id', registrationId)
      .order('registered_at', { ascending: false })

    if (registrationError) {
      console.error('Error fetching registration data:', registrationError)
      return NextResponse.json(
        { error: 'Failed to fetch registration data' },
        { status: 500 }
      )
    }

    // Get waitlist details for this registration
    const { data: waitlistData, error: waitlistError } = await adminSupabase
      .from('waitlists')
      .select(`
        *,
        users!waitlists_user_id_fkey (
          id,
          email,
          first_name,
          last_name,
          is_lgbtq,
          is_goalie,
          phone
        ),
        registration_categories (
          id,
          custom_name,
          categories (
            name
          )
        )
      `)
      .eq('registration_id', registrationId)
      .is('removed_at', null)
      .order('position', { ascending: true })

    if (waitlistError) {
      console.error('Error fetching waitlist data:', waitlistError)
    }

    // Get ALL users who registered as alternates for this registration
    const { data: userAlternateRegistrations, error: userAlternatesError } = await adminSupabase
      .from('user_alternate_registrations')
      .select(`
        id,
        user_id,
        registration_id,
        discount_code_id,
        created_at,
        users!inner (
          id,
          email,
          first_name,
          last_name,
          is_lgbtq,
          is_goalie
        )
      `)
      .eq('registration_id', registrationId)

    if (userAlternatesError) {
      console.error('Error fetching user alternates:', userAlternatesError)
    }

    // Get alternate selections to calculate times_played and total_paid
    const { data: alternateSelectionsData, error: alternatesError } = await adminSupabase
      .from('alternate_selections')
      .select(`
        *,
        users!alternate_selections_user_id_fkey (
          id
        ),
        alternate_registrations!inner (
          id,
          registration_id,
          game_description,
          game_date
        )
      `)
      .eq('alternate_registrations.registration_id', registrationId)
      .order('selected_at', { ascending: false })

    if (alternatesError) {
      console.error('Error fetching alternates selections:', alternatesError)
    }

    // Process the registration data to flatten structure
    const processedData = registrationData?.map(item => {
      const user = Array.isArray(item.users) ? item.users[0] : item.users
      const registration = Array.isArray(item.registrations) ? item.registrations[0] : item.registrations
      const registrationCategory = Array.isArray(item.registration_categories) ? item.registration_categories[0] : item.registration_categories
      const season = registration?.seasons ? (Array.isArray(registration.seasons) ? registration.seasons[0] : registration.seasons) : null
      const category = registrationCategory?.categories ? (Array.isArray(registrationCategory.categories) ? registrationCategory.categories[0] : registrationCategory.categories) : null

      return {
        id: item.id,
        registration_id: item.registration_id,
        registration_name: registration?.name || 'Unknown Registration',
        season_name: season?.name || 'Unknown Season',
        registration_type: registration?.type || 'Unknown',
        user_id: user?.id || 'Unknown',
        first_name: user?.first_name || '',
        last_name: user?.last_name || '',
        member_id: user?.member_id || null,
        email: user?.email || 'Unknown',
        phone: user?.phone || null,
        category_name: category?.name || registrationCategory?.custom_name || 'Unknown Category',
        category_id: item.registration_category_id || 'unknown',
        payment_status: item.payment_status || 'Unknown',
        registered_at: item.registered_at,
        is_lgbtq: user?.is_lgbtq,
        is_goalie: user?.is_goalie || false,
      }
    }) || []

    // Process waitlist data
    const processedWaitlistData = waitlistData?.map(item => {
      const user = Array.isArray(item.users) ? item.users[0] : item.users
      const registrationCategory = Array.isArray(item.registration_categories) ? item.registration_categories[0] : item.registration_categories
      const category = registrationCategory?.categories ? (Array.isArray(registrationCategory.categories) ? registrationCategory.categories[0] : registrationCategory.categories) : null

      return {
        id: item.id,
        user_id: item.user_id,
        first_name: user?.first_name || '',
        last_name: user?.last_name || '',
        email: user?.email || '',
        phone: user?.phone || null,
        category_name: category?.name || registrationCategory?.custom_name || 'Unknown Category',
        category_id: item.registration_category_id || 'unknown',
        position: item.position,
        joined_at: item.joined_at,
        is_lgbtq: user?.is_lgbtq,
        is_goalie: user?.is_goalie || false,
      }
    }) || []

    // Build alternates map from ALL registered alternates
    const alternatesMap = new Map<string, {
      user_id: string
      first_name: string
      last_name: string
      email: string
      is_lgbtq: boolean | null
      is_goalie: boolean
      times_played: number
      total_paid: number
      selections: Array<{
        game_description: string
        game_date: string
        amount_charged: number
        selected_at: string
      }>
    }>()

    // First, add ALL registered alternates to the map (even if they haven't played)
    userAlternateRegistrations?.forEach(altReg => {
      const user = Array.isArray(altReg.users) ? altReg.users[0] : altReg.users
      if (!user) return

      const userId = user.id
      if (!alternatesMap.has(userId)) {
        alternatesMap.set(userId, {
          user_id: userId,
          first_name: user.first_name || '',
          last_name: user.last_name || '',
          email: user.email || 'Unknown',
          is_lgbtq: user.is_lgbtq,
          is_goalie: user.is_goalie || false,
          times_played: 0,
          total_paid: 0,
          selections: []
        })
      }
    })

    // Then, add selection details for those who have played
    alternateSelectionsData?.forEach(selection => {
      const user = Array.isArray(selection.users) ? selection.users[0] : selection.users
      const alternateReg = Array.isArray(selection.alternate_registrations) ? selection.alternate_registrations[0] : selection.alternate_registrations

      if (!user) return

      const userId = user.id
      // Get or create the user entry (should already exist from above)
      if (!alternatesMap.has(userId)) {
        alternatesMap.set(userId, {
          user_id: userId,
          first_name: '',
          last_name: '',
          email: 'Unknown',
          is_lgbtq: null,
          is_goalie: false,
          times_played: 0,
          total_paid: 0,
          selections: []
        })
      }

      const userData = alternatesMap.get(userId)!
      userData.times_played += 1
      userData.total_paid += selection.amount_charged || 0
      userData.selections.push({
        game_description: alternateReg?.game_description || 'Unknown Game',
        game_date: alternateReg?.game_date || '',
        amount_charged: selection.amount_charged || 0,
        selected_at: selection.selected_at
      })
    })

    // Convert map to array
    const processedAlternatesData = Array.from(alternatesMap.values())

    return NextResponse.json({
      data: processedData,
      waitlistData: processedWaitlistData,
      alternatesData: processedAlternatesData,
    })
  } catch (error) {
    console.error('Error in captain roster API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
